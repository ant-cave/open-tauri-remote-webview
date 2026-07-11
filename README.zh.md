# Open Tauri Remote WebView

[![crates.io](https://img.shields.io/crates/v/open-tauri-remote-webview)](https://crates.io/crates/open-tauri-remote-webview)
[![npm](https://img.shields.io/npm/v/open-tauri-remote-webview)](https://www.npmjs.com/package/open-tauri-remote-webview)

**后端（Rust 库）：** `cargo add open-tauri-remote-webview` **（在 `src-tauri/` 目录下运行）**

**前端（JS）：** `npm install open-tauri-remote-webview` **（在项目根目录运行）**

> **English users see [English README](README.md)** — for complete documentation.

---

## 为什么需要它？

开发 Tauri 应用时，有些事是原生 Tauri **做不到**的：

**「想做 E2E 自动化测试，但 Playwright、Cypress 根本不认识 Tauri 的 WebView。」**
Playwright/Cypress 控制的是标准浏览器，而 Tauri 应用运行在系统 WebView 中。原生 Tauri 无法被这些工具直接访问。本插件将应用 UI 通过标准 WebSocket 暴露，所有 Web 测试工具开箱即用。

**「应用需要在远程服务器上运行，但服务器没有显示器。」**
原生 Tauri 依赖本地显示环境，无法在无显示器的服务器上启动后通过浏览器远程访问。本插件让应用像 Web 服务一样，在服务端启动、在浏览器中操作，无需 VNC、无需远程桌面。

**「想在 CI/CD 中做 UI 集成测试，但环境配置极其复杂。」**
在 CI 中测试原生 Tauri 需要模拟显示环境（xvfb 等），且无法与 Web 测试框架集成。本插件让 CI 流水线直接用 Playwright 连接应用，像测试普通网站一样简单。

**「团队中有多个开发者，但每人都要先跑起整个 Tauri 环境才能开始前端开发。」**
有了本插件，团队成员只需打开浏览器就能看到应用界面，无需安装 Rust、无需配置 Tauri 开发环境，前端开发者可以独立工作。

说白了就是：

> **加一行 import，Tauri 应用就能在浏览器里开搞 —— 上面说的这些事，原生 Tauri 一个都干不了，而且你一行业务代码都不用改。**

本项目基于 [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0) by [DraviaVemal](https://github.com/DraviaVemal)，在 MIT 协议下修改。所有新增代码 Copyright (c) 2026 **ant-cave**。（MIT 协议，随便用、随便改、商用也行。唯一的要求：如果分发代码，保留版权声明就行。）

---

## 功能总览

| 能力 | WebView (IPC) | 浏览器 (WS) |
|---|---|---|
| `invoke`（任意命令） | ✅ | ✅ |
| 事件 `listen` / `once` | ✅ | ✅ |
| `@tauri-apps/api/app`（getName、getVersion 等） | ✅ | ✅ 通过桥接 |
| `@tauri-apps/api/window`（title、size 等） | ✅ | ✅ 通过桥接 |
| `@tauri-apps/api/event`（listen、emit） | ✅ | ✅ 通过桥接 |
| Rust 端 `emit` / `emit_to` / `emit_str` 等 → 浏览器 | ✅ | ✅ 通过 `EmitterExt` |
| 安全控制 & 来源限制 | ✅ | ✅ |
| WS 连接状态悬浮调试窗 | — | ✅ 自动显示 |

---

## 与原生 Tauri 的 API 一致性

本插件的设计目标是 **零迁移成本**。所有暴露的 API 签名与原生 Tauri 完全一致：

### Rust 端

| 原生 `tauri::Emitter` | 本插件 `open_tauri_remote_webview::EmitterExt` | 差异 |
|---|---|---|
| `fn emit(...)` **同步** | `fn emit(...)` **同步** ✅ | 无 |
| `fn emit_to(...)` 同步 | `fn emit_to(...)` 同步 ✅ | 无 |
| `fn emit_str(...)` 同步 | `fn emit_str(...)` 同步 ✅ | 无 |
| `fn emit_str_to(...)` 同步 | `fn emit_str_to(...)` 同步 ✅ | 无 |
| `fn emit_filter(...)` 同步 | `fn emit_filter(...)` 同步 ✅ | 无 |
| `fn emit_str_filter(...)` 同步 | `fn emit_str_filter(...)` 同步 ✅ | 无 |

**用法：** 只需把 `use tauri::Emitter` 替换为 `use open_tauri_remote_webview::EmitterExt`，所有调用无需任何改动。

### JS 端

| 原生 `@tauri-apps/api` | 本插件桥接模式 | 本插件显式 API | 差异 |
|---|---|---|---|
| `invoke<T>(cmd, args): Promise<T>` | 透明代理 ✅ | `invoke<T>(cmd, args)` ✅ | 无 |
| `listen<T>(event, handler): Promise<() => void>` | 透明代理 ✅ | `listen<T>(event, handler)` ✅ | 无 |
| `once<T>(event, handler): Promise<() => void>` | 透明代理 ✅ | `once<T>(event, handler)` ✅ | 无 |

### 已知限制（架构决定，非 API 差异）

- **仅支持单窗口模式**：`getCurrentWindow()` 始终返回 `label: "main"`
- **无资产协议**：`convertFileSrc()` 原样返回路径，请使用原始 URL 访问资产
- **无 `__TAURI__` 环境变量**：桥接设置 `__TAURI_REMOTE_UI_SHIM__` 标记作为替代

---

## 从原生 Tauri 迁移

将现有 Tauri 应用迁移到本插件只需少量改动。绝大部分前端代码**保持不变**。

### 改动对照

| 环节 | 之前（原生 Tauri） | 之后（远程模式） |
|---|---|---|
| Rust 插件 | — | 添加 crate + `.plugin(open_tauri_remote_webview::init())` |
| Rust `emit()` | `use tauri::Emitter` | `use open_tauri_remote_webview::EmitterExt`（调用方式不变） |
| Rust 启动 WS 服务器 | — | 在 `setup` 中添加 `app.start_remote_ui(...)` |
| 前端安装 | — | `npm install open-tauri-remote-webview` |
| 前端导入 | `@tauri-apps/api` | **无需改动** — 入口加一行 `import "open-tauri-remote-webview/bridge-init"` |
| `vite.config.ts` | — | 添加 `/remote_ui_ws` 代理 |
| `if (isTauri())` 守卫 | 常见写法 | **删除** — 桥接统一处理 |

### 迁移步骤

1. **Rust 端：** `cargo add open-tauri-remote-webview`，注册插件并启动 WS 服务器（见[使用方法](#使用方法)）。
2. **前端：** `npm install open-tauri-remote-webview`，在入口文件顶部添加 `import "open-tauri-remote-webview/bridge-init"`。
3. **Vite：** 添加 `/remote_ui_ws` 代理（见 [Vite 开发代理](#4-vite-开发代理)）。
4. **清理代码：** 删除所有 `isTauri()` 分支 —— 桥接自动判断环境。
5. **推荐：** 将 `use tauri::Emitter` 替换为 `use open_tauri_remote_webview::EmitterExt`，使后端事件也能到达浏览器客户端。

### 保持不变的部分

- 所有 `@tauri-apps/api/*` 的导入和使用方式
- Rust 端的所有 Tauri 命令定义
- 所有前端构建工具（Vite、Webpack 等）
- 所有事件 `listen`/`once`/`emit` 的使用模式
- 所有窗口和应用 API 调用

---

## 使用方法

### 1. Rust 端

```bash
cargo add open-tauri-remote-webview
```

```rust
use open_tauri_remote_webview::{RemoteUiConfig, RemoteUiExt};

tauri::Builder::default()
    .plugin(open_tauri_remote_webview::init())
    .setup(|app| {
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            handle.start_remote_ui(
                RemoteUiConfig::default().set_port(Some(9090)),
            ).await.ok();
        });
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![/* 你的命令 */])
    .run(tauri::generate_context!())
    .expect("error running app");
```

如果在 Rust 中使用 `emit()` / `emit_to()` / `emit_str()` 等，请将 `use tauri::Emitter` 替换为
`use open_tauri_remote_webview::EmitterExt`，这样事件也会转发到浏览器客户端。
`EmitterExt` 已为 `AppHandle` 和 `WebviewWindow` 实现，签名与原生完全一致。

### 2. 前端 — 零改动（推荐）

```bash
npm install open-tauri-remote-webview
```

在应用入口（`main.ts` / `main.js`）顶部**加一行**：

```javascript
// 自动注入 __TAURI_INTERNALS__ WS 代理 — @tauri-apps/api 直接使用
import "open-tauri-remote-webview/bridge-init";

// 继续使用 @tauri-apps/api，无需任何导入改动
import { invoke } from "@tauri-apps/api/core";
import { getName } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
```

所有 `@tauri-apps/api` 调用在 WebView 中走 IPC、在浏览器中走 WebSocket，
无需写 `if (isTauri())` 分支。

`bridge-init` 会自动显示 **WS 连接状态悬浮窗**（可拖动，点击展开调试面板）。
如需关闭：

```javascript
// 方式 1 — import 前设置全局标记
window.__ORUI_DISABLE_BADGE__ = true;
import "open-tauri-remote-webview/bridge-init";

// 方式 2 — 运行时动态关闭
import { disableFloatingBadge } from "open-tauri-remote-webview/api/core";
disableFloatingBadge();
```

### 3. 前端 — 显式 API（备选）

```javascript
import { invoke, setBaseUrl } from "open-tauri-remote-webview/api/core";
import { listen, once } from "open-tauri-remote-webview/api/event";
```

### 4. Vite 开发代理

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

### 5. 手动启停服务

```rust
async fn enable_server(app: AppHandle, port: u16) -> Result<String, String> {
    app.start_remote_ui(
        RemoteUiConfig::default().set_port(Some(port))
    ).await.map_err(|e| e.to_string())?;
    Ok(format!("服务已启动，端口: {}", port))
}

async fn disable_server(app: AppHandle) -> Result<String, String> {
    app.stop_remote_ui().await.map_err(|e| e.to_string())?;
    Ok("服务已停止".to_string())
}
```

---

## 桥接原理

当应用在浏览器中运行时，`installTauriBridge` 会注入 `__TAURI_INTERNALS__` 代理 shim，
模拟真实的 Tauri 运行时：

```
浏览器 (@tauri-apps/api/*)
  ↓
window.__TAURI_INTERNALS__.invoke(cmd, args)
  ├── "plugin:event|listen"   ──→  本地 WS 事件系统（无需往返）
  ├── "plugin:event|unlisten" ──→  移除本地监听器
  └── 其他所有              ──→  WS → Rust → WebView IPC → 响应
```

- `transformCallback` / `runCallback` — 由 `ShimCallbackManager` 本地管理
- `metadata` — 固定为 `{ label: "main" }`（单窗口模式）
- `convertFileSrc` — 原样返回路径（浏览器没有资产协议）
- `plugins.path` — 从 `navigator.platform` 推断
- `__TAURI_REMOTE_UI_SHIM__` 标记 — 让应用区分 shim 与真实 Tauri

---

## WS 连接状态悬浮窗

`bridge-init` 会自动显示可拖动的连接状态悬浮窗，点击查看详细调试信息。
如需手动控制：

```javascript
import { initFloatingBadge, disableFloatingBadge } from "open-tauri-remote-webview/api/core";

initFloatingBadge();      // 显示
disableFloatingBadge();   // 关闭
```

功能：
- **显示 WS 连接状态**：connected / connecting / disconnected / error
- **可拖动**：用指针对任意位置拖动，不遮挡页面内容
- **点击弹出调试面板**：显示延迟、连接次数、重连次数、在线时长、WS 地址等
- **自动重连**：连接断开后指数退避重连（1s → 2s → 4s → ... → 30s）

---

## 包导出

| 导入路径 | 内容 |
|---|---|
| `open-tauri-remote-webview/bridge-init` | 副作用模块 — 自动安装桥接（推荐） |
| `open-tauri-remote-webview/api/bridge` | `{ installTauriBridge }` — 手动安装 |
| `open-tauri-remote-webview/api/core` | `{ invoke, setBaseUrl, getWsStatus, onWsStatusChange, getWsStats, initFloatingBadge, disableFloatingBadge }` |
| `open-tauri-remote-webview/api/event` | `{ listen, once }` |
| `open-tauri-remote-webview` | 重新导出以上所有内容 |

---

## 插件开发

```bash
# 编译 Rust
cargo build

# 编译 JS
cd guest-js && npm run build

# 一键编译 → 重新安装 → 启动测试（默认监视 guest-js 文件变化，自动重建）
cargo xtask dev

# 分步执行：
# 1) 编译 JS
cd guest-js && npm run build
# 2) 在 test 项目中重新安装本地包
cd test/vue-app && pnpm remove open-tauri-remote-webview && pnpm install open-tauri-remote-webview@file:../../guest-js
# 3) 启动测试应用（有窗口 + devtools）
cd test/vue-app && pnpm tauri dev

# 测试应用（无头模式，只跑 WS 无窗口）
cd test/vue-app && npm run rdev
```

---

## 许可

MIT — 详见 [LICENSE](./LICENSE)。

基于 [`tauri-remote-ui` v0.14.0](https://crates.io/crates/tauri-remote-ui/0.14.0)
Copyright (c) 2025 **DraviaVemal**，以 MIT 协议使用。

新增和修改部分 Copyright (c) 2026 **ant-cave** (<antmmmmm@126.com> / https://github.com/ant-cave)。
