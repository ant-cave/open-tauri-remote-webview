// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use crate::{log_error, log_info, log_warn, RpcServer, WsPayload};
use futures::{stream::SplitSink, SinkExt};
use hyper::upgrade::Upgraded;
use hyper_tungstenite::{tungstenite::Message, WebSocketStream};
use hyper_util::rt::TokioIo;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::json;
use std::sync::Arc;
use tauri::{plugin::PluginApi, AppHandle, Error, Listener, Manager, Runtime};
use tokio::sync::{Mutex, RwLock};

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

    pub(crate) fn invoke_rpc(
        &self,
        payload: String,
        session: Arc<Mutex<SplitSink<WebSocketStream<TokioIo<Upgraded>>, Message>>>,
    ) -> Result<(), Error> {
        let ws_payload: WsPayload = serde_json::from_str(&payload)?;
        log_info!("invoke_rpc", format!("收到 RPC 调用请求: cmd={}, id={}, args={:?}",
            ws_payload.cmd, ws_payload.id, ws_payload.args));
        let window = match self.app.get_webview_window("main") {
            Some(w) => w,
            None => {
                log_warn!("invoke_rpc", "没有 main 窗口 (headless 模式)，返回错误响应给前端");
                let err_msg = json!({"id":ws_payload.id,"payload":"{\"error\":\"WebviewWindow Not Found (headless mode)\"}"}).to_string();
                let session_clone = session.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = session_clone.lock().await.send(Message::text(err_msg)).await {
                        log_error!("invoke_rpc", format!("发送错误响应失败: {:?}", e));
                    }
                });
                return Ok(());
            }
        };
        let req_unique_id = format!("remote-ui::result::{}", &ws_payload.id);
        log_info!("invoke_rpc", format!("注册一次性事件监听: event_id={}", req_unique_id));
        self.app
            .app_handle()
            .once_any(&req_unique_id, move |handler| {
                // Spawn a new task to send the message asynchronously
                let payload = handler.payload().to_string();
                let id = ws_payload.id;
                log_info!("invoke_rpc::callback", format!("Tauri IPC 返回结果, id={}, payload 长度={} 字节, 启动 WebSocket 发送任务", id, payload.len()));
                tauri::async_runtime::spawn(async move {
                    log_info!("invoke_rpc::send_task", format!("准备在 WebSocket 上发送 RPC 结果, id={}", id));
                    let json_msg = json!({"id":id,"payload":payload}).to_string();
                    log_info!("invoke_rpc::send_task", format!("序列化后的 JSON 消息 ({} 字节): id={}", json_msg.len(), id));
                    match session
                        .lock()
                        .await
                        .send(Message::text(json_msg))
                        .await
                    {
                        Ok(_) => {
                            log_info!("invoke_rpc::send_task", format!("RPC 结果发送成功, id={}", id));
                        }
                        Err(err) => {
                            log_error!("invoke_rpc::send_task", format!("WS 发送失败! id={}, 错误类型={:?}, 错误信息={}", id, err, err));
                            log_error!("invoke_rpc::send_task", "这可能是因为 WebSocket 连接已在发送完成前关闭 (race condition)");
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

    /// Emit message to target window to listen
    pub fn emit<P: Serialize + Clone>(&self, event: &str, payload: P) -> Result<(), Error> {
        log_info!("emit", format!("尝试通过 WebSocket 发送事件: event={}", event));
        if let Some(session) = self.rpc_server.get_ws_handle("main") {
            let ws_handle = session.clone();
            let event_owned = event.to_owned();
            let json_str = json!({
                "event":event_owned,
                "payload":payload
            })
            .to_string();
            log_info!("emit", format!("事件 JSON 已序列化 ({} 字节), 启动异步发送任务", json_str.len()));
            tauri::async_runtime::spawn(async move {
                log_info!("emit::send_task", format!("正在发送事件: event={}", event_owned));
                match ws_handle
                    .lock()
                    .await
                    .send(Message::text(json_str))
                    .await
                {
                    Ok(_) => {
                        log_info!("emit::send_task", format!("事件发送成功: event={}", event_owned));
                    }
                    Err(err) => {
                        log_error!("emit::send_task", format!("事件发送失败: event={}, 错误类型={:?}, 错误信息={}", event_owned, err, err));
                    }
                }
            });
        } else {
            log_warn!("emit", format!("未找到 main 窗口的 WebSocket 句柄，无法发送事件: event={}", event));
        }
        Ok(())
    }
}
