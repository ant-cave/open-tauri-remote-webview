use std::sync::atomic::{AtomicI32, Ordering};
use serde::Serialize;
use std::fs;

use open_tauri_remote_webview::{
    EmitterExt, RemoteUiConfig, RemoteUiExt,
};

static COUNTER: AtomicI32 = AtomicI32::new(0);

// ── Basic Types ──────────────────────────────────────────

#[tauri::command]
fn echo_string(value: String) -> String {
    value
}

#[tauri::command]
fn add_numbers(a: i32, b: i32) -> i32 {
    a + b
}

#[tauri::command]
fn to_bool(value: bool) -> String {
    format!("bool is: {}", value)
}

#[tauri::command]
fn echo_json(value: serde_json::Value) -> serde_json::Value {
    value
}

// ── Complex Types ────────────────────────────────────────

#[derive(Serialize)]
struct User {
    id: u32,
    name: String,
    email: String,
    roles: Vec<String>,
}

#[tauri::command]
fn get_user(id: u32) -> User {
    User {
        id,
        name: "Xiao Ming".into(),
        email: "xiaoming@example.com".into(),
        roles: vec!["admin".into(), "user".into()],
    }
}

#[derive(Serialize)]
struct Page<T: Serialize> {
    items: Vec<T>,
    total: u32,
    page: u32,
}

#[tauri::command]
fn get_paginated() -> Page<String> {
    Page {
        items: vec!["item1".into(), "item2".into(), "item3".into()],
        total: 100,
        page: 1,
    }
}

// ── Error Handling ───────────────────────────────────────

#[tauri::command]
fn always_fails() -> Result<String, String> {
    Err("This command intentionally fails".into())
}

#[tauri::command]
fn divide(a: i32, b: i32) -> Result<i32, String> {
    if b == 0 {
        Err("Division by zero".into())
    } else {
        Ok(a / b)
    }
}

// ── Events ───────────────────────────────────────────────

#[tauri::command]
async fn trigger_event(app: tauri::AppHandle, name: String, payload: String) {
    let _ = app.emit(&name, &payload);
}

/// Emit an event to a specific window label (tests emit_to)
#[tauri::command]
async fn emit_to_window(app: tauri::AppHandle, target: String, event: String, payload: String) {
    use tauri::EventTarget;
    let _ = app.emit_to(EventTarget::window(&target), &event, &payload);
}

/// Emit a raw string event (tests em_str pattern)
#[tauri::command]
async fn emit_str_event(app: tauri::AppHandle, name: String, payload: String) {
    let _ = app.emit(&name, &payload);
}

// ── Rust-side Event Trigger Tests ───────────────────────

/// Emit a simple event with no payload
#[tauri::command]
async fn emit_simple_event(app: tauri::AppHandle, name: String) {
    let _ = app.emit(&name, serde_json::Value::Null);
}

/// Emit an event with a string payload
#[tauri::command]
async fn emit_event_with_string(app: tauri::AppHandle, name: String, payload: String) {
    let _ = app.emit(&name, &payload);
}

/// Emit an event with a numeric payload
#[tauri::command]
async fn emit_event_with_number(app: tauri::AppHandle, name: String, payload: f64) {
    let _ = app.emit(&name, payload);
}

/// Emit an event with a boolean payload
#[tauri::command]
async fn emit_event_with_bool(app: tauri::AppHandle, name: String, payload: bool) {
    let _ = app.emit(&name, payload);
}

/// Emit an event with a JSON object payload
#[tauri::command]
async fn emit_event_with_object(app: tauri::AppHandle, name: String, payload: serde_json::Value) {
    let _ = app.emit(&name, payload);
}

/// Emit an event with an array payload
#[tauri::command]
async fn emit_event_with_array(app: tauri::AppHandle, name: String, payload: Vec<serde_json::Value>) {
    let _ = app.emit(&name, payload);
}

/// Emit an event with a nested structure payload
#[tauri::command]
async fn emit_event_with_nested(app: tauri::AppHandle, name: String, payload: serde_json::Value) {
    let _ = app.emit(&name, payload);
}

/// Emit an event to a specific window
#[tauri::command]
async fn emit_to_specific_window(
    app: tauri::AppHandle,
    window_label: String,
    name: String,
    payload: String,
) {
    use tauri::EventTarget;
    let _ = app.emit_to(EventTarget::window(&window_label), &name, &payload);
}

/// Emit an event to all windows
#[tauri::command]
async fn emit_to_all_windows(app: tauri::AppHandle, name: String, payload: String) {
    let _ = app.emit(&name, &payload);
}

/// Emit multiple events sequentially
#[tauri::command]
async fn emit_multiple_events(app: tauri::AppHandle, events: Vec<(String, String)>) {
    for (name, payload) in events {
        let _ = app.emit(&name, &payload);
    }
}

/// Return server running status
#[tauri::command]
async fn is_server_running(app: tauri::AppHandle) -> bool {
    app.is_remote_ui_running().await
}

/// Test Window<R> EmitterExt — emits an event from a Window parameter
#[tauri::command]
fn emit_from_window(window: tauri::Window, name: String, payload: String) -> Result<(), String> {
    window.emit(&name, &payload).map_err(|e| e.to_string())
}

// ── Original Commands ────────────────────────────────────

fn notes_path() -> std::path::PathBuf {
    let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.pop();
    p.pop();
    p.push("test/data/notes.txt");
    p
}

#[tauri::command]
fn read_notes() -> Result<String, String> {
    fs::read_to_string(notes_path()).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_notes(content: String) -> Result<(), String> {
    let path = notes_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn increment(value: i32) -> i32 {
    COUNTER.fetch_add(value, Ordering::SeqCst) + value
}

#[tauri::command]
async fn enable_server(app: tauri::AppHandle, port: u16) -> Result<String, String> {
    app.start_remote_ui(
        RemoteUiConfig::default()
            .set_port(Some(port))
            .set_allowed_origin(open_tauri_remote_webview::OriginType::Localhost),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(format!("Server started on port {}", port))
}

#[tauri::command]
async fn disable_server(app: tauri::AppHandle) -> Result<String, String> {
    app.stop_remote_ui()
        .await
        .map_err(|e| e.to_string())?;
    Ok("Server stopped".to_string())
}

/// Restart the WebSocket server on a given port (stops first if running)
#[tauri::command]
async fn restart_server(app: tauri::AppHandle, port: u16) -> Result<String, String> {
    app.stop_remote_ui().await.map_err(|e| e.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    app.start_remote_ui(
        RemoteUiConfig::default()
            .set_port(Some(port))
            .set_allowed_origin(open_tauri_remote_webview::OriginType::Localhost),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(format!("Server restarted on port {}", port))
}

/// Re-start server with log enabled/disabled config
#[tauri::command]
async fn toggle_server_log(app: tauri::AppHandle, port: u16, enable: bool) -> Result<String, String> {
    let mut cfg = RemoteUiConfig::default()
        .set_port(Some(port))
        .set_allowed_origin(open_tauri_remote_webview::OriginType::Localhost);
    if enable {
        cfg = cfg.enable_log();
    } else {
        cfg = cfg.disable_log();
    }
    app.start_remote_ui(cfg).await.map_err(|e| e.to_string())?;
    Ok(format!("Server restarted on port {} (log={})", port, enable))
}

/// Start server with full configuration: optional port, log toggle, and origin type
#[tauri::command]
async fn start_server_with_config(
    app: tauri::AppHandle,
    port: Option<u16>,
    enable_log: bool,
    origin: String,
) -> Result<String, String> {
    // Stop existing server first
    app.stop_remote_ui().await.map_err(|e| e.to_string())?;

    let origin_type = match origin.as_str() {
        "localhost" => open_tauri_remote_webview::OriginType::Localhost,
        "direct" => open_tauri_remote_webview::OriginType::Direct,
        "any" => open_tauri_remote_webview::OriginType::Any,
        _ => open_tauri_remote_webview::OriginType::Localhost,
    };

    let mut cfg = RemoteUiConfig::default()
        .set_port(port)
        .set_allowed_origin(origin_type);

    if enable_log {
        cfg = cfg.enable_log();
    } else {
        cfg = cfg.disable_log();
    }

    app.start_remote_ui(cfg).await.map_err(|e| e.to_string())?;
    let port_str = port.map(|p| p.to_string()).unwrap_or_else(|| "random".to_string());
    Ok(format!("Server started on port {} (origin={}, log={})", port_str, origin, enable_log))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(open_tauri_remote_webview::init())
        .invoke_handler(tauri::generate_handler![
            // Basic types
            echo_string,
            add_numbers,
            to_bool,
            echo_json,
            // Complex types
            get_user,
            get_paginated,
            // Error handling
            always_fails,
            divide,
            // Events
            trigger_event,
            emit_to_window,
            emit_str_event,
            // Rust-side event trigger tests
            emit_simple_event,
            emit_event_with_string,
            emit_event_with_number,
            emit_event_with_bool,
            emit_event_with_object,
            emit_event_with_array,
            emit_event_with_nested,
            emit_to_specific_window,
            emit_to_all_windows,
            emit_multiple_events,
            // Server status
            is_server_running,
            // Window<R> EmitterExt
            emit_from_window,
            // Original
            increment,
            enable_server,
            disable_server,
            restart_server,
            toggle_server_log,
            start_server_with_config,
            read_notes,
            write_notes,
        ])
        .setup(|app| {
            #[cfg(not(feature = "headless"))]
            {
                use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
                let window = WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::App("index.html".into()),
                )
                .title("Vue App")
                .inner_size(800.0, 600.0)
                .resizable(true)
                .build()?;
                let _ = window.open_devtools();
            }
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match app_handle.start_remote_ui(
                    open_tauri_remote_webview::RemoteUiConfig::default()
                        .set_port(Some(9090))
                        .set_allowed_origin(open_tauri_remote_webview::OriginType::Localhost),
                )
                .await
                {
                    Ok(_) => println!("[setup] WS server auto-started (port 9090)"),
                    Err(e) => eprintln!("[setup] WS server auto-start failed: {e}"),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
