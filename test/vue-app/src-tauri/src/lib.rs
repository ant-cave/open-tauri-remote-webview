use std::sync::atomic::{AtomicI32, Ordering};
use tauri::Emitter;
use serde::Serialize;
use std::fs;

use open_tauri_remote_webview::{
    RemoteUiConfig, RemoteUiExt,
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
        name: "小明".into(),
        email: "xiaoming@example.com".into(),
        roles: vec!["管理员".into(), "用户".into()],
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
            // Original
            increment,
            enable_server,
            disable_server,
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
                    Ok(_) => println!("[setup] WS 服务器自动启动成功 (端口 9090)"),
                    Err(e) => eprintln!("[setup] WS 服务器自动启动失败: {e}"),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
