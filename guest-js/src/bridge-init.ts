// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

/**
 * Side-effect module: auto-installs `__TAURI_INTERNALS__` shim in browser
 * and pre-warms the WebSocket connection.
 *
 * Usage: add `import "open-tauri-remote-webview/bridge-init"` once at your app entry
 * (before any @tauri-apps/api usage). No other code changes needed.
 */
import { installTauriBridge } from "./tauri-internals.js";
import { initFloatingBadge } from "./floating-badge.js";
import wsClient from "./ws.js";
import * as logger from "./logger.js";
import { setNativeTauri } from "./environment.js";

const MODULE = "bridge-init";
logger.info(MODULE, "=== 模块开始加载 ===");
logger.debug(MODULE, "导入依赖完成: tauri-internals, floating-badge, wsClient");

// Detect native Tauri BEFORE any shim installation.
// In a real Tauri WebView, __TAURI_INTERNALS__ is injected by the runtime itself,
// so IPC works natively and no WS bridge is needed.
//
// IMPORTANT: Tauri's injection may be asynchronous - __TAURI_INTERNALS__ might not
// be available immediately when this module loads. We use polling to wait for it.
logger.info(MODULE, "开始检测运行环境（含异步轮询）...");
logger.debug(MODULE, `window 对象存在: ${typeof window !== "undefined"}`);

const POLL_INTERVAL = 50;
const POLL_TIMEOUT = 3000;

function detectNativeTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return !!w.__TAURI_INTERNALS__ && !w.__TAURI_REMOTE_UI_SHIM__;
}

function detectBrowserSignals(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI_REMOTE_UI_SHIM__) return false;
  if (w.__TAURI_INTERNALS__) return false;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("tauri")) return true;
  if (w.chrome && (w.chrome as Record<string, unknown>).webview) return true;
  return false;
}

async function waitForTauriDetection(): Promise<boolean> {
  if (detectNativeTauri()) {
    logger.info(MODULE, "立即检测到 __TAURI_INTERNALS__，确认为原生 Tauri");
    return true;
  }

  if (detectBrowserSignals()) {
    logger.info(MODULE, "检测到浏览器环境信号（User-Agent/webview 标记）");
    return false;
  }

  logger.info(MODULE, `未立即检测到 Tauri，开始轮询等待（间隔 ${POLL_INTERVAL}ms，超时 ${POLL_TIMEOUT}ms）...`);
  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < POLL_TIMEOUT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    pollCount++;

    if (detectNativeTauri()) {
      const elapsed = Date.now() - startTime;
      logger.info(MODULE, `轮询第 ${pollCount} 次检测到 __TAURI_INTERNALS__（耗时 ${elapsed}ms），确认为原生 Tauri`);
      return true;
    }

    if (detectBrowserSignals()) {
      const elapsed = Date.now() - startTime;
      logger.info(MODULE, `轮询第 ${pollCount} 次检测到浏览器信号（耗时 ${elapsed}ms），确认为远程浏览器`);
      return false;
    }

    logger.debug(MODULE, `轮询第 ${pollCount} 次，未检测到 Tauri/浏览器信号，继续等待...`);
  }

  const elapsed = Date.now() - startTime;
  logger.warn(MODULE, `轮询超时（${pollCount} 次，耗时 ${elapsed}ms），判定为远程浏览器环境`);
  return false;
}

(async () => {
  const isNativeTauri = await waitForTauriDetection();
  logger.info(MODULE, `最终环境检测结果: isNativeTauri=${isNativeTauri}`);
  setNativeTauri(isNativeTauri);

  if (!isNativeTauri) {
    logger.info(MODULE, "--- 开始配置 WebSocket 连接参数 ---");
    const urlOverride = (window as unknown as Record<string, unknown>).__ORUI_WS_URL__;
    const portOverride = (window as unknown as Record<string, unknown>).__ORUI_WS_PORT__;

    logger.debug(MODULE, `__ORUI_WS_URL__ 覆盖值: ${typeof urlOverride === "string" ? urlOverride : "未设置"}`);
    logger.debug(MODULE, `__ORUI_WS_PORT__ 覆盖值: ${typeof portOverride === "number" ? portOverride : "未设置"}`);

    if (typeof urlOverride === "string") {
      logger.info(MODULE, `使用 URL 覆盖模式，设置 WS URL: ${urlOverride}`);
      wsClient.setUrl(urlOverride);
    } else if (typeof portOverride === "number") {
      logger.info(MODULE, `使用端口覆盖模式，设置 WS 端口: ${portOverride}`);
      wsClient.setPort(portOverride);
    } else {
      logger.info(MODULE, "未检测到 URL/端口覆盖，将使用自动检测逻辑");
    }

    logger.info(MODULE, "开始预连接 WebSocket...");
    wsClient.connect().then(() => {
      logger.info(MODULE, "WebSocket 预连接成功");
    }).catch((err) => {
      logger.warn(MODULE, `WebSocket 预连接失败（将在后续重试）: ${err}`);
    });
  } else {
    logger.info(MODULE, "跳过 WebSocket 配置（原生 Tauri 环境）");
  }

  if (isNativeTauri) {
    logger.info(MODULE, "跳过 Tauri Bridge Shim 安装（原生 Tauri 环境已有 __TAURI_INTERNALS__）");
  } else {
    logger.info(MODULE, "--- 开始安装 Tauri Bridge Shim ---");
    installTauriBridge();
    logger.info(MODULE, "Tauri Bridge Shim 安装流程完成");
  }

  const badgeDisabled = typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__ORUI_DISABLE_BADGE__;
  logger.debug(MODULE, `__ORUI_DISABLE_BADGE__ 设置: ${badgeDisabled}`);

  if (!isNativeTauri && !badgeDisabled) {
    logger.info(MODULE, "--- 初始化浮动状态徽章 ---");
    initFloatingBadge();
    logger.info(MODULE, "浮动状态徽章初始化完成");
  } else if (isNativeTauri) {
    logger.info(MODULE, "跳过徽章初始化（原生 Tauri 环境）");
  } else if (badgeDisabled) {
    logger.info(MODULE, "跳过徽章初始化（已通过 __ORUI_DISABLE_BADGE__ 禁用）");
  }

  logger.info(MODULE, "=== bridge-init 模块加载完成 ===");
})();
