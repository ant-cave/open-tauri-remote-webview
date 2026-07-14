// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use crate::{log_error, log_info, log_warn, CommandRegistry, RpcServer};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
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

    /// Send a JSON response over WebSocket
    #[cfg(feature = "ws")]
    fn send_ws_response(
        session: &Arc<Mutex<SplitSink<WebSocketStream<TokioIo<Upgraded>>, Message>>>,
        response: serde_json::Value,
    ) {
        let session = session.clone();
        tauri::async_runtime::spawn(async move {
            let msg = serde_json::to_string(&response).unwrap();
            if let Err(e) = session.lock().await.send(Message::text(msg)).await {
                log_error!("send_ws_response", format!("Failed to send WS response: {:?}", e));
            }
        });
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

        // Try command registry first — no WebView needed
        if let Some(registry) = self.app.try_state::<CommandRegistry>() {
            if let Some(result) = registry.dispatch(&ws_payload.cmd, ws_payload.args.clone()) {
                log_info!("invoke_rpc", format!("Command dispatched via registry: cmd={}, id={}", ws_payload.cmd, ws_payload.id));
                let response = match result {
                    Ok(value) => {
                        let inner = json!({"status": "success", "payload": value});
                        json!({"id": ws_payload.id, "payload": inner.to_string()})
                    }
                    Err(err) => {
                        let inner = json!({"status": "error", "payload": err});
                        json!({"id": ws_payload.id, "payload": inner.to_string()})
                    }
                };
                Self::send_ws_response(&session, response);
                return Ok(());
            }
        }

        // Fall back to WebView eval path
        let window = match self.app.get_webview_window("main") {
            Some(w) => w,
            None => {
                log_warn!("invoke_rpc", "No main webview window (headless mode), sending error response");
                let inner = json!({"error": "WebviewWindow Not Found (headless mode) and command not found in registry"});
                let response = json!({"id": ws_payload.id, "payload": inner.to_string()});
                Self::send_ws_response(&session, response);
                return Ok(());
            }
        };
        let req_unique_id = format!("remote-ui::result::{}", &ws_payload.id);
        let timeout_id = ws_payload.id;
        log_info!("invoke_rpc", format!("Registering one-shot event listener: event_id={}", req_unique_id));

        // Timeout safety net — prevents hanging if the eval'd JS never fires
        let timeout_session = session.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let err_inner = json!({"status": "error", "payload": "invoke timed out after 30s"});
            let err_response = json!({"id": timeout_id, "payload": err_inner.to_string()});
            let msg = serde_json::to_string(&err_response).unwrap();
            let _ = timeout_session.lock().await.send(Message::text(msg)).await;
        });

        self.app
            .app_handle()
            .once_any(&req_unique_id, move |handler| {
                let payload = handler.payload().to_string();
                let id = ws_payload.id;
                log_info!("invoke_rpc::callback", format!("Tauri IPC returned, id={}, payload size={} bytes, starting WS send task", id, payload.len()));
                let session = session.clone();
                tauri::async_runtime::spawn(async move {
                    let json_msg = json!({"id":id,"payload":payload}).to_string();
                    if let Err(e) = session.lock().await.send(Message::text(json_msg)).await {
                        log_error!("invoke_rpc::send_task", format!("WS send failed! id={}, error={:?}", id, e));
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

    /// Emit message to all WS-connected browser clients
    #[cfg(feature = "ws")]
    pub fn emit<P: Serialize + Clone>(&self, event: &str, payload: P) -> Result<(), Error> {
        let handles = self.rpc_server.get_all_ws_handles();
        if handles.is_empty() {
            log_warn!("emit", format!("No WS clients connected, cannot send event: event={}", event));
            return Ok(());
        }
        log_info!("emit", format!("Broadcasting event via WS to {} client(s): event={}", handles.len(), event));
        let event_owned = event.to_owned();
        let json_str = serde_json::json!({"event": event_owned, "payload": payload}).to_string();
        for ws_handle in handles {
            tauri::async_runtime::spawn({
                let event_owned = event_owned.clone();
                let json_str = json_str.clone();
                async move {
                    match ws_handle.lock().await.send(Message::text(json_str)).await {
                        Ok(_) => {
                            log_info!("emit::send_task", format!("Event sent: event={}", event_owned));
                        }
                        Err(err) => {
                            log_error!("emit::send_task", format!("Event send failed: event={}, error={:?}", event_owned, err));
                        }
                    }
                }
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn ws_payload_deserialize_basic() {
        let raw = r#"{"id":1,"cmd":"greet","args":{"name":"World"},"option":null}"#;
        let payload: crate::WsPayload = serde_json::from_str(raw).unwrap();
        assert_eq!(payload.id, 1);
        assert_eq!(payload.cmd, "greet");
        assert_eq!(payload.args, Some(json!({"name":"World"})));
        assert_eq!(payload.option, None);
    }

    #[test]
    fn ws_payload_deserialize_with_option() {
        let raw = r#"{"id":99,"cmd":"configure","args":{"theme":"dark"},"option":{"timeout":5000}}"#;
        let payload: crate::WsPayload = serde_json::from_str(raw).unwrap();
        assert_eq!(payload.id, 99);
        assert_eq!(payload.cmd, "configure");
        assert_eq!(payload.args, Some(json!({"theme":"dark"})));
        assert_eq!(payload.option, Some(json!({"timeout":5000})));
    }

    #[test]
    fn ws_payload_deserialize_no_args_no_option() {
        let raw = r#"{"id":5,"cmd":"status"}"#;
        let payload: crate::WsPayload = serde_json::from_str(raw).unwrap();
        assert_eq!(payload.id, 5);
        assert_eq!(payload.cmd, "status");
        assert!(payload.args.is_none());
        assert!(payload.option.is_none());
    }

    #[test]
    fn ws_payload_deserialize_array_args() {
        let raw = r#"{"id":3,"cmd":"sum","args":[1,2,3,4,5]}"#;
        let payload: crate::WsPayload = serde_json::from_str(raw).unwrap();
        assert_eq!(payload.id, 3);
        assert_eq!(payload.cmd, "sum");
        assert_eq!(payload.args, Some(json!([1,2,3,4,5])));
    }

    #[test]
    fn ws_payload_deserialize_string_args() {
        let raw = r#"{"id":0,"cmd":"echo","args":"hello"}"#;
        let payload: crate::WsPayload = serde_json::from_str(raw).unwrap();
        assert_eq!(payload.id, 0);
        assert_eq!(payload.args, Some(json!("hello")));
    }
}
