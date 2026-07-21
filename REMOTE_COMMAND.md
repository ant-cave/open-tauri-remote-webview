# `#[remote_command]` — 无头远程调用指南

让 `#[tauri::command]` 函数无需 WebView 即可通过 WebSocket 调用。

## 安装

```bash
cargo add open-tauri-remote-webview
```

`open-tauri-remote-webview-macros` 作为依赖自动安装，无需手动添加。

## 一句话用法

```rust
use open_tauri_remote_webview::{remote_command, register_remote_commands};

#[tauri::command]
#[remote_command]               // ← 加这一行
fn my_cmd(name: String) -> String {
    format!("Hello {name}")
}

// 在 setup() 中注册：
.setup(|app| {
    register_remote_commands!(app, [
        my_cmd,
        another_cmd,
    ]);
    Ok(())
})
```

## 原理

`#[remote_command]` 为函数自动生成 `__orui_wrap__<fn_name>`，它：
1. 从 `Option<serde_json::Value>` 反序列化参数
2. 调用原函数（自动跳过 `AppHandle`/`Window`/`State` 等 Tauri 注入参数）
3. 序列化返回值
4. 支持 `async` / sync，支持 `Result<T, E>` 和普通值

`register_remote_commands!` 在 setup 中将所有 wrapper 注册到 `CommandRegistry`。

## 完整示例

```rust
use open_tauri_remote_webview::{remote_command, register_remote_commands, EmitterExt, RemoteUiConfig, RemoteUiExt};

// 普通返回值
#[tauri::command]
#[remote_command]
fn echo_string(value: String) -> String {
    value
}

// 返回 Result
#[tauri::command]
#[remote_command]
fn divide(a: i32, b: i32) -> Result<i32, String> {
    if b == 0 { Err("Division by zero".into()) } else { Ok(a / b) }
}

// async 命令
#[tauri::command]
#[remote_command]
async fn get_data(id: u32) -> Result<String, String> {
    Ok(format!("data-{id}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(open_tauri_remote_webview::init())
        .invoke_handler(tauri::generate_handler![echo_string, divide, get_data])
        .setup(|app| {
            register_remote_commands!(app, [echo_string, divide, get_data]);

            let h = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                h.start_remote_ui(RemoteUiConfig::default()).await.ok();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error");
}
```

## 自动跳过的参数

`#[remote_command]` 自动检测并跳过以下 Tauri 注入参数（无需在 `[]` 中列出）：

| 参数类型 | 原因 |
|---|---|
| `AppHandle` | 由 Tauri 框架提供 |
| `Window` | 由 Tauri 框架提供 |
| `State<'_, T>` | 由 Tauri 框架提供 |
| `WebviewWindow` | 由 Tauri 框架提供 |

例如 `fn cmd(app: AppHandle, name: String)` — wrapper 只接收 `name`。

## 返回值处理

| 函数签名 | wrapper 行为 |
|---|---|
| `fn(...) -> T` | `serde_json::to_value(T)`，包裹在 `Ok()` 中 |
| `fn(...) -> Result<T, E>` | 先 `?` 解包，再 `to_value(T)`，错误用 `e.to_string()` |
| `async fn(...) -> T` | `block_on(async { ... })` |
| `async fn(...) -> Result<T, E>` | `block_on(async { ... }).map_err(|e| e.to_string())?` |

错误类型 `E` 需要实现 `ToString`（标准库错误类型都满足）。

## `register_remote_commands!` 语法

```ignore
register_remote_commands!(app, [
    fn_name_1,
    fn_name_2,
    fn_name_3,
]);
```

只需函数名，不需要参数类型或 `result` 关键字（这些由 `#[remote_command]` 自动推导）。

## 如果不想用 `#[remote_command]`

可以手动使用 `CommandRegistry` 直接注册：

```rust
use open_tauri_remote_webview::{CommandRegistry, RemoteUiConfig, RemoteUiExt};
use serde_json::Value;

fn my_command(args: Option<Value>) -> Result<Value, String> {
    let name: String = serde_json::from_value(
        args.unwrap_or(serde_json::json!({}))
            .get("name")
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    ).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "greeting": format!("Hello {name}") }))
}

// 在 setup() 中
let registry = app.state::<CommandRegistry>();
registry.register("my_command", my_command);
```

> **注意：** 手动注册时命令函数接收原始的 `Option<Value>` 参数，需要自行解析。

## 已知限制

- 不支持 `&str` 参数（必须用 `String`）
- 不支持 `&[u8]` 参数（必须用 `Vec<u8>`）
- 错误类型必须实现 `ToString`（几乎所有标准错误类型都满足）
- 不支持在 wrapper 中提供 `AppHandle`/`Window`/`State`（设计如此——这些参数在无头模式下没有意义）
- 需要 `enable feature(proc_macro)` — 已通过独立 proc macro crate 支持，无需 nightly
