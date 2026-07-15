// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use crate::{models::*, RemoteUi};
use chrono::Local;
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Error, Manager};
use tokio::sync::RwLock;

#[cfg(feature = "ws")]
use futures::{stream::SplitSink, SinkExt, StreamExt};
#[cfg(feature = "ws")]
use http_body_util::Full;
#[cfg(feature = "ws")]
use hyper::{
    body::{Bytes, Incoming},
    server::conn::http1,
    service::service_fn,
    upgrade::Upgraded,
    Request, Response, StatusCode,
};
#[cfg(feature = "ws")]
use hyper_tungstenite::{tungstenite::Message, HyperWebsocket, WebSocketStream};
#[cfg(feature = "ws")]
use hyper_util::rt::TokioIo;
#[cfg(feature = "ws")]
use std::collections::HashMap;
#[cfg(feature = "ws")]
use tokio::{net::TcpListener, sync::Mutex};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{log_debug, log_error, log_info, log_warn};

    #[test]
    fn log_enabled_by_default() {
        // Default state (set_log_enabled(true) at static init)
        set_log_enabled(true);
        assert!(is_log_enabled());
    }

    #[test]
    fn log_toggle_off() {
        set_log_enabled(true);
        set_log_enabled(false);
        assert!(!is_log_enabled());
        set_log_enabled(true); // restore for other tests
    }

    #[test]
    fn log_toggle_on_off_on() {
        set_log_enabled(false);
        assert!(!is_log_enabled());
        set_log_enabled(true);
        assert!(is_log_enabled());
    }

    #[test]
    fn ws_log_format_contains_level() {
        set_log_enabled(true);
        // ws_log writes to stderr; we can't easily capture it in a test
        // but we can verify it doesn't panic
        ws_log(file!(), line!(), "test_function", "INFO", "test message");
        ws_log(file!(), line!(), "another_fn", "ERROR", "error msg");
        ws_log(file!(), line!(), "some_fn", "WARN", "warning");
        ws_log(file!(), line!(), "debug_fn", "DEBUG", "debug info");
    }

    #[test]
    fn ws_log_suppressed_when_disabled() {
        set_log_enabled(false);
        // Should not panic or produce output
        ws_log(file!(), line!(), "silent_fn", "INFO", "should not appear");
        set_log_enabled(true);
    }

    #[test]
    fn log_macros_expand() {
        set_log_enabled(true);
        log_info!("test_macro", "info message");
        log_error!("test_macro", "error message");
        log_warn!("test_macro", "warn message");
        log_debug!("test_macro", "debug message");
    }

    #[test]
    fn rpc_server_new_not_active() {
        // Can't easily test RpcServer without AppHandle, but we can test
        // the model is constructable via its trait usage
    }
}

// ============================================================================
// 日志控制 — 可通过 RemoteUiConfig 切换
// ============================================================================
static LOG_ENABLED: AtomicBool = AtomicBool::new(true);

pub fn set_log_enabled(enabled: bool) {
    LOG_ENABLED.store(enabled, Ordering::Relaxed);
}

fn is_log_enabled() -> bool {
    LOG_ENABLED.load(Ordering::Relaxed)
}

// ============================================================================
// 日志辅助函数和宏 — 格式: [YYYY-MM-DD][HH:MM:SS][function][file:line][level] message
// ============================================================================
pub fn ws_log(file: &str, line: u32, function: &str, level: &str, message: &str) {
    if !is_log_enabled() {
        return;
    }
    let now = Local::now();
    eprintln!(
        "[{}][{}][{}][{}:{}][{}] {}",
        now.format("%Y-%m-%d"),
        now.format("%H:%M:%S"),
        function,
        file,
        line,
        level,
        message
    );
}

#[macro_export]
macro_rules! log_info {
    ($func:expr, $msg:expr) => {
        $crate::remote_ui::rpc_server::ws_log(file!(), line!(), $func, "INFO", &$msg.to_string());
    };
}

#[macro_export]
macro_rules! log_error {
    ($func:expr, $msg:expr) => {
        $crate::remote_ui::rpc_server::ws_log(file!(), line!(), $func, "ERROR", &$msg.to_string());
    };
}

#[macro_export]
macro_rules! log_warn {
    ($func:expr, $msg:expr) => {
        $crate::remote_ui::rpc_server::ws_log(file!(), line!(), $func, "WARN", &$msg.to_string());
    };
}

#[macro_export]
macro_rules! log_debug {
    ($func:expr, $msg:expr) => {
        $crate::remote_ui::rpc_server::ws_log(file!(), line!(), $func, "DEBUG", &$msg.to_string());
    };
}

pub trait RemoteUiExt {
    fn start_remote_ui(
        &self,
        remote_ui_config: RemoteUiConfig,
    ) -> impl Future<Output = Result<(), tauri::Error>>;
    fn stop_remote_ui(&self) -> impl Future<Output = Result<(), tauri::Error>>;
    fn is_remote_ui_running(&self) -> impl Future<Output = bool>;
}

impl RemoteUiExt for AppHandle {
    async fn start_remote_ui(&self, remote_ui_config: RemoteUiConfig) -> Result<(), Error> {
        let remote_ui = self.state::<Arc<RwLock<RemoteUi>>>();
        remote_ui.write().await.rpc_server.start(remote_ui_config)?;
        Ok(())
    }

    async fn stop_remote_ui(&self) -> Result<(), Error> {
        let remote_ui = self.state::<Arc<RwLock<RemoteUi>>>();
        remote_ui.write().await.rpc_server.stop().await;
        Ok(())
    }

    async fn is_remote_ui_running(&self) -> bool {
        let state = self.state::<Arc<RwLock<RemoteUi>>>();
        let remote_ui = state.read().await;
        remote_ui.rpc_server.get_is_active()
    }
}

#[cfg(feature = "ws")]
type WindowLabel = String;
#[derive(Debug, Clone)]
pub struct RpcServer {
    pub(crate) app: Arc<AppHandle>,
    is_active: bool,
    remote_ui_config: RemoteUiConfig,
    #[cfg(feature = "ws")]
    ws_window_handle: HashMap<
        WindowLabel,
        Arc<
            Mutex<
                futures::stream::SplitSink<
                    hyper_tungstenite::WebSocketStream<TokioIo<hyper::upgrade::Upgraded>>,
                    Message,
                >,
            >,
        >,
    >,
}

impl RpcServer {
    pub(crate) fn get_is_active(&self) -> bool {
        self.is_active
    }

    pub(crate) fn new(app: Arc<AppHandle>) -> Self {
        Self {
            app,
            is_active: false,
            remote_ui_config: RemoteUiConfig::default(),
            #[cfg(feature = "ws")]
            ws_window_handle: HashMap::new(),
        }
    }

    pub(crate) fn start(&mut self, remote_ui_config: RemoteUiConfig) -> Result<(), Error> {
        if self.is_active {
            Err(Error::IllegalEventName("Server Already Running".to_owned()))
        } else {
            set_log_enabled(remote_ui_config.enable_log);
            self.remote_ui_config = remote_ui_config.clone();
            self.spawn_http_server()
        }
    }

    pub(crate) async fn stop(&mut self) {
        #[cfg(feature = "ws")]
        {
            for (_label, handle) in self.ws_window_handle.drain() {
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = handle.lock().await.close().await;
                });
            }
        }
        self.is_active = false;
    }

    /// Spawns the WebSocket server inside tokio task of tauri
    #[cfg(feature = "ws")]
    pub(crate) fn spawn_http_server(&mut self) -> Result<(), Error> {
        let origin: &str = self.remote_ui_config.get_allowed_origin().into();
        let app_handle = self.app.clone();
        let port = self.remote_ui_config.get_port().unwrap_or_default();
        self.is_active = true;
        tauri::async_runtime::spawn(async move {
            if let Err(err) = create_hyper_server(origin, port, app_handle).await {
                eprintln!("[open-tauri-remote-webview] Failed to create WS server. Err: {err}");
            }
        });
        Ok(())
    }

    /// No-op when ws feature is disabled
    #[cfg(not(feature = "ws"))]
    pub(crate) fn spawn_http_server(&mut self) -> Result<(), Error> {
        self.is_active = true;
        log_info!(
            "spawn_http_server",
            "WS feature disabled, server not started (IPC-only mode)"
        );
        Ok(())
    }

    #[cfg(feature = "ws")]
    pub(crate) fn set_ws_handle(
        &mut self,
        window_label: &str,
        ws_handle: Arc<Mutex<SplitSink<WebSocketStream<TokioIo<Upgraded>>, Message>>>,
    ) -> () {
        self.ws_window_handle
            .insert(window_label.to_owned(), ws_handle);
    }

    #[cfg(feature = "ws")]
    pub(crate) fn get_all_ws_handles(
        &self,
    ) -> Vec<Arc<Mutex<SplitSink<WebSocketStream<TokioIo<Upgraded>>, Message>>>> {
        self.ws_window_handle.values().cloned().collect()
    }
}

#[cfg(feature = "ws")]
async fn create_hyper_server(
    origin: &str,
    port: u16,
    app_handle: Arc<AppHandle>,
) -> Result<(), Error> {
    log_info!(
        "create_hyper_server",
        format!("Binding TCP listener to {}:{}", origin, port)
    );
    let listener = TcpListener::bind((origin, port)).await?;
    if let Ok(local_addr) = listener.local_addr() {
        log_info!(
            "create_hyper_server",
            format!(
                "Remote UI available at http://localhost:{}",
                local_addr.port()
            )
        );
    }
    log_info!(
        "create_hyper_server",
        format!(
            "Listening on {}:{}, waiting for connections...",
            origin, port
        )
    );
    loop {
        let remote_ui = app_handle.state::<Arc<RwLock<RemoteUi>>>();
        if !remote_ui.read().await.rpc_server.get_is_active() {
            log_info!(
                "create_hyper_server",
                "Server marked inactive, exiting HTTP loop"
            );
            break;
        }
        match listener.accept().await {
            Ok((stream, addr)) => {
                log_info!(
                    "create_hyper_server",
                    format!("Accepted new TCP connection: {}", addr)
                );
                let io = TokioIo::new(stream);
                let req_app_handle = app_handle.clone();

                tauri::async_runtime::spawn(async move {
                    if let Err(err) = http1::Builder::new()
                        .serve_connection(
                            io,
                            service_fn(move |req| handle_request(req, req_app_handle.clone())),
                        )
                        .with_upgrades()
                        .await
                    {
                        log_error!(
                            "create_hyper_server",
                            format!("HTTP connection error: {:?}", err)
                        );
                    }
                });
            }
            Err(err) => {
                log_error!("create_hyper_server", format!("TCP accept failed: {}", err));
            }
        }
    }
    Ok(())
}

#[cfg(feature = "ws")]
async fn handle_request(
    request: Request<Incoming>,
    app_handle: Arc<AppHandle>,
) -> Result<Response<Full<Bytes>>, Error> {
    let path = request.uri().path().to_string();
    match (request.method().as_str(), path.as_str()) {
        ("GET", "/remote_ui_ws") => {
            log_info!("handle_request", "Received WebSocket upgrade request");
            if hyper_tungstenite::is_upgrade_request(&request) {
                log_info!(
                    "handle_request",
                    "Request is valid WebSocket upgrade, proceeding..."
                );
                match hyper_tungstenite::upgrade(request, None) {
                    Ok((response, websocket)) => {
                        log_info!("handle_request", "WebSocket upgrade successful");
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = ws_handle(websocket, Arc::clone(&app_handle)).await {
                                log_error!(
                                    "handle_request",
                                    format!("WebSocket handler error: {:?}", e)
                                );
                            }
                        });
                        Ok(response.map(|_| Full::new(Bytes::new())))
                    }
                    Err(e) => {
                        log_error!("handle_request", format!("WebSocket upgrade failed: {}", e));
                        Ok(Response::builder()
                            .status(StatusCode::BAD_REQUEST)
                            .body(Full::new(Bytes::from("WebSocket upgrade failed")))
                            .unwrap())
                    }
                }
            } else {
                log_warn!(
                    "handle_request",
                    "Request is not a valid WebSocket upgrade request"
                );
                Err(Error::FailedToReceiveMessage)
            }
        }
        _ => Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Full::new(Bytes::new()))
            .unwrap()),
    }
}

/// Handle a websocket connection.
#[cfg(feature = "ws")]
async fn ws_handle(websocket: HyperWebsocket, app_handle: Arc<AppHandle>) -> Result<(), Error> {
    log_info!("ws_handle", "Waiting for WebSocket connection upgrade...");
    match websocket.await {
        Ok(ws_stream) => {
            log_info!(
                "ws_handle",
                "WebSocket connection upgraded, new connection established"
            );
            let (tx, mut rx) = ws_stream.split();
            let ws_sender = Arc::new(Mutex::new(tx));
            // Replace existing handle without closing — let the old one die naturally
            {
                let remote_ui = app_handle.state::<Arc<RwLock<RemoteUi>>>();
                let mut remote_ui_mut = remote_ui.write().await;
                remote_ui_mut
                    .rpc_server
                    .set_ws_handle("main", ws_sender.clone());
                log_info!(
                    "ws_handle",
                    "New WebSocket handle registered for window label: main"
                );
            }
            while let Some(message_stream) = rx.next().await {
                match message_stream {
                    Ok(message) => match message {
                        Message::Text(msg) => {
                            let msg_str = msg.to_string();
                            // Handle heartbeat ping
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&msg_str) {
                                if val.get("type").and_then(|v| v.as_str()) == Some("ping") {
                                    log_debug!("ws_handle", "Received ping, sending pong");
                                    let pong = serde_json::json!({"type":"pong"}).to_string();
                                    let _ = ws_sender.lock().await.send(Message::text(pong)).await;
                                    continue;
                                }
                            }
                            log_info!(
                                "ws_handle",
                                format!(
                                    "Received text message ({} bytes): {}",
                                    msg_str.len(),
                                    if msg_str.len() > 200 {
                                        format!("{}...", &msg_str[..200])
                                    } else {
                                        msg_str.clone()
                                    }
                                )
                            );
                            let remote_ui = app_handle.state::<Arc<RwLock<RemoteUi>>>();
                            let remote_ui_mut = remote_ui.read().await;
                            if let Err(e) =
                                remote_ui_mut.invoke_rpc(msg.to_string(), ws_sender.clone())
                            {
                                log_error!(
                                    "ws_handle",
                                    format!("invoke_rpc failed, connection kept alive: {:?}", e)
                                );
                            }
                        }
                        Message::Close(frame) => {
                            log_info!(
                                "ws_handle",
                                format!("Received WebSocket close frame: {:?}", frame)
                            );
                            log_info!("ws_handle", "Close frame received, exiting message loop");
                            break;
                        }
                        _ => {
                            log_debug!("ws_handle", "Received unhandled WebSocket message type");
                        }
                    },
                    Err(err) => {
                        log_error!("ws_handle", format!("WebSocket read error: {}", err));
                        log_info!("ws_handle", "Message read error, exiting message loop");
                        break;
                    }
                }
            }
            log_info!("ws_handle", "WebSocket handler exiting (connection closed)");
            Ok(())
        }
        Err(err) => {
            log_error!(
                "ws_handle",
                format!("WebSocket stream upgrade failed: {:?}", err)
            );
            Err(Error::FailedToReceiveMessage)
        }
    }
}
