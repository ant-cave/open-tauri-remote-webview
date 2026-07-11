// MIT License
// Copyright (c) 2025 DraviaVemal
// See LICENSE file in the root directory.

use crate::{models::*, RemoteUi};
use chrono::Local;
use futures::{stream::SplitSink, SinkExt, StreamExt};
use http_body_util::Full;
use hyper::{
    body::{Bytes, Incoming},
    server::conn::http1,
    service::service_fn,
    upgrade::Upgraded,
    Request, Response, StatusCode,
};
use hyper_tungstenite::{tungstenite::Message, HyperWebsocket, WebSocketStream};
use hyper_util::rt::TokioIo;
use std::{collections::HashMap, future::Future, sync::Arc};
use tauri::{AppHandle, Error, Manager};
use tokio::{
    net::TcpListener,
    sync::{Mutex, RwLock},
};

// ============================================================================
// 日志辅助函数和宏 — 格式: [年月日][时分秒][函数/模块][文件:行数][级别] 具体信息
// ============================================================================
pub fn ws_log(file: &str, line: u32, function: &str, level: &str, message: &str) {
    let now = Local::now();
    eprintln!(
        "[{}][{}][{}][{}:{}][{}] {}",
        now.format("%Y年%m月%d日"),
        now.format("%H时%M分%S秒"),
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
        remote_ui.write().await.rpc_server.stop();
        Ok(())
    }

    async fn is_remote_ui_running(&self) -> bool {
        let state = self.state::<Arc<RwLock<RemoteUi>>>();
        let remote_ui = state.read().await;
        remote_ui.rpc_server.get_is_active()
    }
}

type WindowLabel = String;
#[derive(Debug, Clone)]
pub struct RpcServer {
    pub(crate) app: Arc<AppHandle>,
    is_active: bool,
    remote_ui_config: RemoteUiConfig,
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
            ws_window_handle: HashMap::new(),
        }
    }

    pub(crate) fn start(&mut self, remote_ui_config: RemoteUiConfig) -> Result<(), Error> {
        if self.is_active {
            Err(Error::IllegalEventName("Server Already Running".to_owned()))
        } else {
            self.remote_ui_config = remote_ui_config.clone();
            self.spawn_http_server()
        }
    }

    pub(crate) fn stop(&mut self) {
        self.is_active = false;
    }

    /// Spawns the WebSocket server inside tokio task of tauri
    pub(crate) fn spawn_http_server(&mut self) -> Result<(), Error> {
        let origin = "0.0.0.0";
        let app_handle = self.app.clone();
        let port = self.remote_ui_config.get_port().unwrap_or_default();
        self.is_active = true;
        tauri::async_runtime::spawn(async move {
            if let Err(err) = create_hyper_server(origin, port, app_handle).await {
                eprintln!("Failed to create WS server for Remote UI plugin. Err:{err}");
            }
        });
        Ok(())
    }

    pub(crate) fn set_ws_handle(
        &mut self,
        window_label: &str,
        ws_handle: Arc<Mutex<SplitSink<WebSocketStream<TokioIo<Upgraded>>, Message>>>,
    ) -> () {
        self.ws_window_handle
            .insert(window_label.to_owned(), ws_handle);
    }

    pub(crate) fn get_ws_handle(
        &self,
        window_label: &str,
    ) -> Option<&Arc<Mutex<SplitSink<WebSocketStream<TokioIo<Upgraded>>, Message>>>> {
        self.ws_window_handle.get(window_label)
    }
}

async fn create_hyper_server(
    origin: &str,
    port: u16,
    app_handle: Arc<AppHandle>,
) -> Result<(), Error> {
    log_info!("create_hyper_server", format!("正在绑定 TCP 监听器到 {}:{}", origin, port));
    let listener = TcpListener::bind((origin, port)).await?;
    log_info!("create_hyper_server", format!("TCP 监听器已绑定到 {}:{}，等待连接...", origin, port));
    loop {
        let remote_ui = app_handle.state::<Arc<RwLock<RemoteUi>>>();
        if !remote_ui.read().await.rpc_server.get_is_active() {
            log_info!("create_hyper_server", "服务已标记为未激活，退出 HTTP 监听循环");
            break;
        }
        match listener.accept().await {
            Ok((stream, addr)) => {
                log_info!("create_hyper_server", format!("接受新的 TCP 连接: {}", addr));
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
                        log_error!("create_hyper_server", format!("HTTP 连接服务错误: {:?}", err));
                    }
                });
            }
            Err(err) => {
                log_error!("create_hyper_server", format!("接受 TCP 连接失败: {}", err));
            }
        }
    }
    Ok(())
}

async fn handle_request(
    request: Request<Incoming>,
    app_handle: Arc<AppHandle>,
) -> Result<Response<Full<Bytes>>, Error> {
    let path = request.uri().path().to_string();
    match (request.method().as_str(), path.as_str()) {
        ("GET", "/remote_ui_ws") => {
            log_info!("handle_request", "收到 WebSocket 升级请求");
            if hyper_tungstenite::is_upgrade_request(&request) {
                log_info!("handle_request", "请求是有效的 WebSocket 升级请求，执行升级...");
                match hyper_tungstenite::upgrade(request, None) {
                    Ok((response, websocket)) => {
                        log_info!("handle_request", "WebSocket 升级成功");
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = ws_handle(websocket, Arc::clone(&app_handle)).await {
                                log_error!("handle_request", format!("WebSocket 处理错误: {:?}", e));
                            }
                        });
                        Ok(response.map(|_| Full::new(Bytes::new())))
                    }
                    Err(e) => {
                        log_error!("handle_request", format!("WebSocket 升级失败: {}", e));
                        Ok(Response::builder()
                            .status(StatusCode::BAD_REQUEST)
                            .body(Full::new(Bytes::from("WebSocket upgrade failed")))
                            .unwrap())
                    }
                }
            } else {
                log_warn!("handle_request", "请求不是有效的 WebSocket 升级请求");
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
async fn ws_handle(websocket: HyperWebsocket, app_handle: Arc<AppHandle>) -> Result<(), Error> {
    log_info!("ws_handle", "等待 WebSocket 连接升级...");
    match websocket.await {
        Ok(ws_stream) => {
            log_info!("ws_handle", "WebSocket 连接升级成功，新的连接已建立");
            let (tx, mut rx) = ws_stream.split();
            let ws_sender = Arc::new(Mutex::new(tx));
            // Replace existing handle without closing — let the old one die naturally
            {
                let remote_ui = app_handle.state::<Arc<RwLock<RemoteUi>>>();
                let mut remote_ui_mut = remote_ui.write().await;
                remote_ui_mut
                    .rpc_server
                    .set_ws_handle("main", ws_sender.clone());
                log_info!("ws_handle", "新的 WebSocket 句柄已注册到窗口标签: main");
            }
            while let Some(message_stream) = rx.next().await {
                match message_stream {
                    Ok(message) => match message {
                        Message::Text(msg) => {
                            let msg_str = msg.to_string();
                            // Handle heartbeat ping
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&msg_str) {
                                if val.get("type").and_then(|v| v.as_str()) == Some("ping") {
                                    log_debug!("ws_handle", "收到 ping，回复 pong");
                                    let pong = serde_json::json!({"type":"pong"}).to_string();
                                    let _ = ws_sender.lock().await.send(Message::text(pong)).await;
                                    continue;
                                }
                            }
                            log_info!(
                                "ws_handle",
                                format!("收到文本消息 ({} 字节): {}",
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
                            if let Err(e) = remote_ui_mut.invoke_rpc(msg.to_string(), ws_sender.clone()) {
                                log_error!("ws_handle", format!("invoke_rpc 失败但连接保持: {:?}", e));
                            }
                        }
                        Message::Close(frame) => {
                            log_info!("ws_handle", format!("收到 WebSocket 关闭帧: {:?}", frame));
                            log_info!("ws_handle", "关闭帧已收到，退出消息接收循环");
                            break;
                        }
                        _ => {
                            log_debug!("ws_handle", "收到未处理的 WebSocket 消息类型");
                        }
                    },
                    Err(err) => {
                        log_error!("ws_handle", format!("读取 WebSocket 消息失败: {}", err));
                        log_info!("ws_handle", "消息读取错误，退出消息接收循环");
                        break;
                    }
                }
            }
            log_info!("ws_handle", "WebSocket 连接处理器即将退出 (连接已关闭)");
            Ok(())
        }
        Err(err) => {
            log_error!("ws_handle", format!("WebSocket 流升级失败: {:?}", err));
            Err(Error::FailedToReceiveMessage)
        }
    }
}


