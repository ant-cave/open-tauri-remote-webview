# Open Tauri Remote WebView

[![crates.io](https://img.shields.io/crates/v/open-tauri-remote-webview)](https://crates.io/crates/open-tauri-remote-webview)
[![npm](https://img.shields.io/npm/v/open-tauri-remote-webview)](https://www.npmjs.com/package/open-tauri-remote-webview)

Tauri v2 插件，通过 WebSocket 桥接 Tauri 的 IPC 层（commands + events），让浏览器可以像 WebView 一样调用 Tauri 后端。

> **English docs: [README.md](README.md)**

## 适用场景

- **前端开发** — 在浏览器中用完整 DevTools 开发调试前端，不需要 Rust 工具链
- **E2E 测试** — Playwright / Cypress 直接连 Tauri 后端
- **CI/CD** — 无 xvfb 测试 IPC 层

## 不适用场景

- **不是远程渲染器** — 浏览器加载自己的前端副本，通过 WS 通信，看不到 WebView 的渲染输出
- **不是完整 API 替代** — 只桥接了 `invoke`、`listen`、`once`，`dialog`/`fs`/`shell` 等需要自定义命令

---

## 5 分钟快速上手

### 第 1 步：Rust 端（2 分钟）

```bash
cd src-tauri
cargo add open-tauri-remote-webview
```

修改 `src-tauri/src/lib.rs`，只需加 3 处：

```rust
use open_tauri_remote_webview::{RemoteUiConfig, RemoteUiExt}; // ① 加 import

pub fn run() {
    tauri::Builder::default()
        .plugin(open_tauri_remote_webview::init()) // ② 注册插件
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                handle
                    .start_remote_ui(
                        RemoteUiConfig::default()
                            .set_port(Some(9090))  // WS 端口
                            .enable_log(),
                    )
                    .await
                    .ok();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![/* 你的命令 */])
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

### 第 2 步：前端（1 分钟）

```bash
npm install open-tauri-remote-webview
```

在入口文件（`main.ts` / `main.js`）**最顶部**加一行：

```javascript
import "open-tauri-remote-webview/bridge-init";

// 下面继续正常用 @tauri-apps/api，不用改任何东西
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
```

### 第 3 步：Vite 代理（1 分钟）

```javascript
// vite.config.ts
server: {
  proxy: {
    "/remote_ui_ws": {
      target: "ws://127.0.0.1:9090",
      ws: true,
    },
  },
},
```

完成。启动 `vite dev` 后在浏览器访问即可，所有 `@tauri-apps/api` 调用自动走 WebSocket。

---

## 推荐：无头模式（`#[remote_command]`）

默认情况下，通过 WS 调用的命令仍需 WebView 分发。加上 `#[remote_command]` 后可以直接在 Rust 端分发，无需 WebView：

```rust
use open_tauri_remote_webview::{remote_command, register_remote_commands};

#[tauri::command]
#[remote_command]  // 加这一行
fn echo_string(value: String) -> String {
    value
}

#[tauri::command]
#[remote_command]
fn divide(a: i32, b: i32) -> Result<i32, String> {
    if b == 0 {
        Err("Division by zero".into())
    } else {
        Ok(a / b)
    }
}
```

然后在 `setup()` 中注册：

```rust
.setup(|app| {
    register_remote_commands!(app, [
        echo_string,
        divide,
    ]);
    // ...
    Ok(())
})
```

原理：`#[remote_command]` 自动生成 `__orui_wrap__<fn_name>` wrapper 函数，`register_remote_commands!` 将它们注册到 `CommandRegistry`。详见 [REMOTE_COMMAND.md](REMOTE_COMMAND.md)。

---

## Rust 端完整用法

### EmitterExt — 替换 tauri::Emitter

如果在 Rust 中用 `emit()` / `emit_to()` 等，只需把 import 换一行，事件会自动转发到浏览器客户端：

```rust
// 之前
use tauri::Emitter;

// 之后
use open_tauri_remote_webview::EmitterExt;
```

签名完全一致，支持 `AppHandle`、`WebviewWindow`、`Window` 三种类型，全部 6 个 emit 方法均为同步。

### 手动启停服务

```rust
async fn enable_server(app: AppHandle, port: u16) -> Result<String, String> {
    app.start_remote_ui(RemoteUiConfig::default().set_port(Some(port)))
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!("服务已启动，端口: {}", port))
}

async fn disable_server(app: AppHandle) -> Result<String, String> {
    app.stop_remote_ui().await.map_err(|e| e.to_string())?;
    Ok("服务已停止".to_string())
}
```

### CommandRegistry — 底层 API

如需手动注册命令（不用宏）：

```rust
use open_tauri_remote_webview::{CommandRegistry, RemoteUiConfig, RemoteUiExt};
use serde_json::Value;

fn my_command(args: Option<Value>) -> Result<Value, String> {
    Ok(serde_json::json!({"status": "ok"}))
}

// 在 setup() 中
let registry = app.state::<CommandRegistry>();
registry.register("my_command", my_command);
```

### Cargo features

- `ws`（默认启用）— WebSocket 支持，禁用后减小依赖体积
- `--no-default-features` — 只需 WebView 内 IPC 模式时使用

---

## 前端完整用法

### 零改动模式（推荐）

```javascript
import "open-tauri-remote-webview/bridge-init";

// @tauri-apps/api 原样使用，无需 if (isTauri()) 分支
```

`bridge-init` 自动检测环境：
- 原生 WebView → 使用真实 IPC
- 浏览器 → 安装 WS 桥接 shim
- 无需轮询、无需 User-Agent 检测

### 显式 API（备选）

```javascript
import { invoke, setBaseUrl } from "open-tauri-remote-webview/api/core";
import { listen, once } from "open-tauri-remote-webview/api/event";
```

### 配置 WS 地址

```javascript
// 方式 1：完整 URL
window.__ORUI_WS_URL__ = "ws://192.168.1.100:9090/remote_ui_ws";

// 方式 2：仅端口（自动用当前 hostname）
window.__ORUI_WS_PORT__ = 9090;

import "open-tauri-remote-webview/bridge-init";
```

### 关闭悬浮调试窗

```javascript
// import 前设置
window.__ORUI_DISABLE_BADGE__ = true;
import "open-tauri-remote-webview/bridge-init";

// 或运行时关闭
import { disableFloatingBadge } from "open-tauri-remote-webview/api/core";
disableFloatingBadge();
```

### 包导出一览

| 导入路径 | 内容 |
|---|---|
| `open-tauri-remote-webview/bridge-init` | 副作用模块，自动安装桥接（推荐） |
| `open-tauri-remote-webview/api/core` | `invoke`, `setBaseUrl`, WS 状态 API, 悬浮窗控制 |
| `open-tauri-remote-webview/api/event` | `listen`, `once` |
| `open-tauri-remote-webview/api/bridge` | `installTauriBridge`（手动安装） |

---

## 从原生 Tauri 迁移

### 改动清单

| 环节 | 之前 | 之后 |
|---|---|---|
| Rust 插件 | — | 加 crate + `.plugin(open_tauri_remote_webview::init())` |
| Rust emit | `use tauri::Emitter` | `use open_tauri_remote_webview::EmitterExt`（调用不变） |
| Rust 启动 WS | — | setup 里加 `start_remote_ui()` |
| 前端 | — | 加 `import "open-tauri-remote-webview/bridge-init"` |
| Vite | — | 加 `/remote_ui_ws` 代理 |
| isTauri() 分支 | 常见写法 | **删除** — 桥接自动处理 |

### 不需要改的

- 所有 `@tauri-apps/api/*` 导入和用法
- Rust 端所有 Tauri 命令定义
- 所有前端构建工具（Vite / Webpack）
- 所有事件 `listen`/`once`/`emit` 模式

---

## 功能对照表

| 能力 | WebView (IPC) | 浏览器 (WS) |
|---|---|---|
| `invoke`（任意命令） | ✅ | ✅ |
| 事件 `listen` / `once` | ✅ | ✅ |
| `@tauri-apps/api/app` | ✅ | ✅ 通过桥接 |
| `@tauri-apps/api/window` | ✅ | ✅ 通过桥接 |
| `@tauri-apps/api/event` | ✅ | ✅ 通过桥接 |
| Rust `emit` → 浏览器 | ✅ | ✅ 通过 `EmitterExt` |
| IP 访问控制 | ✅ | ✅ |
| WS 悬浮调试窗 | — | ✅ 自动显示 |

## 已知限制

| 限制 | 说明 | 解决方法 |
|---|---|---|
| 单窗口模式 | `getCurrentWindow()` 始终返回 `label: "main"` | 在命令中用明确的窗口标签 |
| 无资产协议 | `convertFileSrc()` 原样返回路径 | 用原始 URL |
| invoke 默认需要 WebView | 未注册命令需真实 WebviewWindow 分发 | 用 `#[remote_command]` 注册 |
| 未认证 WS | WebSocket 端点无认证 | 用防火墙/网络隔离 |

---

## 插件开发

```bash
# 编译 Rust
cargo build

# 编译 JS
cd guest-js && npm run build

# 一键：编译 → 安装 → 启动（监听文件变化自动重建）
cargo xtask dev

# 手动分步
cd guest-js && npm run build
cd test/vue-app && pnpm remove open-tauri-remote-webview && pnpm install open-tauri-remote-webview@file:../../guest-js
cd test/vue-app && pnpm tauri dev

# 无头模式（无窗口）
cd test/vue-app && npm run rdev
```

---

## License

MIT — 详见 [LICENSE](./LICENSE)。

基于 [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0) by [DraviaVemal](https://github.com/DraviaVemal)，MIT 协议。
新增和修改部分 Copyright (c) 2026 **ant-cave** (<antmmmmm@126.com> / https://github.com/ant-cave)。
