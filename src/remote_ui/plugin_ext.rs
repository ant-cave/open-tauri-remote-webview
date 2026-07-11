// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use crate::{log_error, log_info, log_warn, RpcServer};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::json;
use std::sync::Arc;
use tauri::{plugin::PluginApi, AppHandle, Error, Listener, Manager, Runtime};
use tokio::sync::RwLock;

#[cfg(feature = "ws")]
use crate::WsPayload;
#[cfg(feature = "ws")]
use tokio::sync::Mutex;
#[cfg(feature = "ws")]
use futures::{stream::SplitSink, SinkExt};
#[cfg(feature = "ws")]
use hyper::upgrade::Upgraded;
#[cfg(feature = "ws")]
use hyper_tungstenite::{tungstenite::Message, WebSocketStream};
#[cfg(feature = "ws")]
use hyper_util::rt::TokioIo;

pub fn init<R, C>(app: &AppHandle, _api: PluginApi<R, C>) -> crate::Result<Arc<RwLock<RemoteUi>>>
where
    C: DeserializeOwned,
    R: Runtime,
{
    let app_handle = Arc::new(app.clone());
    let remote_ui = Arc::new(RwLock::new(RemoteUi {
        app: app_handle.clone(),
        rpc_server: RpcServer::new(app_handle),
    }));
    Ok(remote_ui)
}

#[derive(Debug, Clone)]
/// Access to the remote-ui APIs.
pub struct RemoteUi {
    pub(crate) app: Arc<AppHandle>,
    pub(crate) rpc_server: RpcServer,
}

impl RemoteUi {
    pub(crate) fn is_rpc_active(&self) -> bool {
        self.rpc_server.get_is_active()
    }

    #[cfg(feature = "ws")]
    pub(crate) fn invoke_rpc(
        &self,
        payload: String,
        session: Arc<Mutex<SplitSink<WebSocketStream<TokioIo<Upgraded>>, Message>>>,
    ) -> Result<(), Error> {
        let ws_payload: WsPayload = serde_json::from_str(&payload)?;
        log_info!("invoke_rpc", format!("Received RPC request: cmd={}, id={}, args={:?}",
            ws_payload.cmd, ws_payload.id, ws_payload.args));
        let window = match self.app.get_webview_window("main") {
            Some(w) => w,
            None => {
                log_warn!("invoke_rpc", "No main webview window (headless mode), sending error response");
                let err_msg = json!({"id":ws_payload.id,"payload":"{\"error\":\"WebviewWindow Not Found (headless mode)\"}"}).to_string();
                let session_clone = session.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = session_clone.lock().await.send(Message::text(err_msg)).await {
                        log_error!("invoke_rpc", format!("Failed to send error response: {:?}", e));
                    }
                });
                return Ok(());
            }
        };
        let req_unique_id = format!("remote-ui::result::{}", &ws_payload.id);
        log_info!("invoke_rpc", format!("Registering one-shot event listener: event_id={}", req_unique_id));
        self.app
            .app_handle()
            .once_any(&req_unique_id, move |handler| {
                // Spawn a new task to send the message asynchronously
                let payload = handler.payload().to_string();
                let id = ws_payload.id;
                log_info!("invoke_rpc::callback", format!("Tauri IPC returned, id={}, payload size={} bytes, starting WS send task", id, payload.len()));
                tauri::async_runtime::spawn(async move {
                    log_info!("invoke_rpc::send_task", format!("Preparing to send RPC result over WS, id={}", id));
                    let json_msg = json!({"id":id,"payload":payload}).to_string();
                    log_info!("invoke_rpc::send_task", format!("Serialized JSON message ({} bytes): id={}", json_msg.len(), id));
                    match session
                        .lock()
                        .await
                        .send(Message::text(json_msg))
                        .await
                    {
                        Ok(_) => {
                            log_info!("invoke_rpc::send_task", format!("RPC result sent successfully, id={}", id));
                        }
                        Err(err) => {
                            log_error!("invoke_rpc::send_task", format!("WS send failed! id={}, error={:?}, msg={}", id, err, err));
                            log_error!("invoke_rpc::send_task", "This may be due to WS connection closing before send completes (race condition)");
                        }
                    }
                });
            });
        let js = format!(
            r#"
            window.__TAURI_INTERNALS__.invoke("{}",{},{})
                .then((res) => {{
                        window.__TAURI_INTERNALS__.invoke("plugin:event|emit",{{
                        event:"{}",
                        payload:{{
                            status: "success",
                            payload:res
                        }}
                    }})
                }})
                .catch((err) => {{
                    window.__TAURI_INTERNALS__.invoke("plugin:event|emit",{{
                        event:"{}",
                        payload:{{
                            status: "error",
                            payload:err
                        }}
                    }})
                }});
            "#,
            ws_payload.cmd,
            serde_json::to_string(&ws_payload.args).unwrap(),
            serde_json::to_string(&ws_payload.option).unwrap(),
            &req_unique_id,
            &req_unique_id
        );
        window.eval(js)?;
        Ok(())
    }

    /// Emit message to WS-connected browser clients
    #[cfg(feature = "ws")]
    pub fn emit<P: Serialize + Clone>(&self, event: &str, payload: P) -> Result<(), Error> {
        log_info!("emit", format!("Attempting to send event via WS: event={}", event));
        if let Some(session) = self.rpc_server.get_ws_handle("main") {
            let ws_handle = session.clone();
            let event_owned = event.to_owned();
            let json_str = json!({
                "event":event_owned,
                "payload":payload
            })
            .to_string();
            log_info!("emit", format!("Event JSON serialized ({} bytes), spawning async send task", json_str.len()));
            tauri::async_runtime::spawn(async move {
                log_info!("emit::send_task", format!("Sending event: event={}", event_owned));
                match ws_handle
                    .lock()
                    .await
                    .send(Message::text(json_str))
                    .await
                {
                    Ok(_) => {
                        log_info!("emit::send_task", format!("Event sent successfully: event={}", event_owned));
                    }
                    Err(err) => {
                        log_error!("emit::send_task", format!("Event send failed: event={}, error={:?}, msg={}", event_owned, err, err));
                    }
                }
            });
        } else {
            log_warn!("emit", format!("No WS handle for 'main' window, cannot send event: event={}", event));
        }
        Ok(())
    }
}
