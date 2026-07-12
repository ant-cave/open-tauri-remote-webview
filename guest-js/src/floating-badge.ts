// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
//
// Based on https://crates.io/crates/tauri-remote-ui/0.14.0 by DraviaVemal (MIT).
// See LICENSE file in the root directory.

/**
 * Floating WS connection status badge with drag support and debug panel.
 *
 * Usage:
 *   import { initFloatingBadge } from "open-tauri-remote-webview/api/core"
 *   initFloatingBadge()
 */

import wsClient from "./ws.js";
import * as logger from "./logger.js";

const MODULE = "floating-badge";
logger.info(MODULE, "=== 模块开始加载 ===");

function formatUptime(ms: number): string {
  logger.debug(MODULE, `formatUptime() 输入: ${ms}ms`);
  if (ms < 1000) {
    const result = ms + "ms";
    logger.debug(MODULE, `formatUptime() 输出: ${result}`);
    return result;
  }
  if (ms < 60000) {
    const result = (ms / 1000).toFixed(1) + "s";
    logger.debug(MODULE, `formatUptime() 输出: ${result}`);
    return result;
  }
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const result = m + "m " + s + "s";
  logger.debug(MODULE, `formatUptime() 输出: ${result}`);
  return result;
}

export interface FloatingBadgeOptions {
  /** Position preset. Default: "bottom-right" */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** Whether to start visible. Default: true */
  visible?: boolean;
}

let cleanupFloatingBadge: (() => void) | null = null;
logger.debug(MODULE, "cleanupFloatingBadge 变量已初始化");

export function disableFloatingBadge() {
  logger.info(MODULE, ">>> disableFloatingBadge() 调用");
  if (cleanupFloatingBadge) {
    logger.debug(MODULE, "执行清理函数");
    cleanupFloatingBadge();
    cleanupFloatingBadge = null;
    logger.info(MODULE, "浮动徽章已禁用并清理");
  } else {
    logger.debug(MODULE, "无清理函数可执行（徽章未初始化）");
  }
}

export function initFloatingBadge(options?: FloatingBadgeOptions): () => void {
  logger.info(MODULE, ">>> initFloatingBadge() 开始执行");
  logger.debug(MODULE, `传入选项: ${JSON.stringify(options)}`);

  if (typeof document === "undefined") {
    logger.warn(MODULE, "document 对象不存在，跳过初始化");
    return () => {};
  }
  logger.debug(MODULE, "document 对象检查通过");

  // If already initialized, clean up first
  if (cleanupFloatingBadge) {
    logger.info(MODULE, "检测到已存在的徽章实例，执行清理");
    cleanupFloatingBadge();
  }

  const pos = options?.position ?? "bottom-right";
  logger.debug(MODULE, `徽章位置设置为: ${pos}`);
  let showDebug = false;
  let statsTimer: ReturnType<typeof setInterval> | null = null;

  // ---- create elements ----
  logger.debug(MODULE, "创建徽章 DOM 元素");
  const badge = document.createElement("div");
  badge.className = "orui-badge orui-" + pos;
  logger.debug(MODULE, `徽章元素已创建，className: ${badge.className}`);

  const dot = document.createElement("span");
  dot.className = "orui-dot";
  const label = document.createElement("span");
  label.className = "orui-label";
  badge.append(dot, label);
  logger.debug(MODULE, "徽章内部元素（dot 和 label）已创建并附加");

  const panel = document.createElement("div");
  panel.className = "orui-panel";
  panel.style.display = "none";
  logger.debug(MODULE, "调试面板元素已创建（初始隐藏）");

  document.body.append(badge);
  document.body.append(panel);
  logger.info(MODULE, "徽章和面板已添加到 DOM");

  // ---- inject styles ----
  const styleId = "orui-badge-style";
  logger.debug(MODULE, `检查样式是否已注入 (styleId: ${styleId})`);
  if (!document.getElementById(styleId)) {
    logger.info(MODULE, "样式未注入，开始创建并注入样式表");
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.orui-badge {
  position: fixed;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100px;
  height: 24px;
  border-radius: 12px;
  font-size: 11px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: rgba(246,248,250,0.92);
  border: 1px solid #d0d7de;
  opacity: 0.7;
  transition: opacity 0.2s;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  backdrop-filter: blur(4px);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.orui-badge:hover { opacity: 1; }
.orui-badge:active { cursor: grabbing; }
.orui-badge { touch-action: none; }
.orui-badge.orui-bottom-right { bottom: 8px; right: 8px; }
.orui-badge.orui-bottom-left { bottom: 8px; left: 8px; }
.orui-badge.orui-top-right { top: 8px; right: 8px; }
.orui-badge.orui-top-left { top: 8px; left: 8px; }

.orui-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  display: inline-block;
  pointer-events: none;
  flex-shrink: 0;
}
.orui-badge.orui-connected .orui-dot { background: #2da44e; }
.orui-badge.orui-connecting .orui-dot { background: #d4920b; animation: orui-pulse 1s infinite; }
.orui-badge.orui-disconnected .orui-dot,
.orui-badge.orui-error .orui-dot { background: #cf222e; }
.orui-badge.orui-closing .orui-dot { background: #d4920b; }

@keyframes orui-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.orui-label {
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.3px;
  pointer-events: none;
  font-size: 10px;
  color: #24292f;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 72px;
}

.orui-panel {
  position: fixed;
  min-width: 250px;
  background: rgba(255,255,255,0.98);
  border: 1px solid #d0d7de;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  z-index: 100000;
  pointer-events: auto;
  cursor: default;
  color: #24292f;
  backdrop-filter: blur(8px);
}

.orui-panel .orui-title {
  font-weight: 700;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid #d0d7de;
}
.orui-panel table { width: 100%; border-collapse: collapse; }
.orui-panel td { padding: 2px 4px; vertical-align: top; }
.orui-panel td:first-child {
  color: #656d76;
  white-space: nowrap;
  padding-right: 8px;
}
.orui-panel .orui-url { word-break: break-all; font-size: 11px; }
.orui-panel .orui-error { color: #cf222e; word-break: break-all; font-size: 11px; }
.orui-panel .orui-ok { color: #2da44e; font-weight: 600; }
.orui-panel .orui-warn { color: #d4920b; font-weight: 600; }
.orui-panel .orui-bad { color: #cf222e; font-weight: 600; }
.orui-log-title { font-weight: 700; margin-top: 6px; padding-top: 4px; border-top: 1px solid #d0d7de; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
.orui-copy-btn { font-size: 10px; padding: 1px 6px; border: 1px solid #d0d7de; border-radius: 4px; background: #f6f8fa; cursor: pointer; color: #24292f; font-family: inherit; }
.orui-copy-btn:hover { background: #e1e4e8; }
.orui-log { font-size: 10px; line-height: 1.4; max-height: 150px; overflow-y: auto; background: #f6f8fa; padding: 4px 6px; border-radius: 4px; white-space: pre-wrap; word-break: break-all; color: #24292f; font-family: "JetBrains Mono", "Fira Code", monospace; }
`;
    document.head.append(style);
    logger.info(MODULE, "样式表注入完成");
  } else {
    logger.debug(MODULE, "样式表已存在，跳过注入");
  }

  // ---- state sync ----
  logger.info(MODULE, "初始化状态同步");
  function renderStatus(s: string) {
    logger.debug(MODULE, `renderStatus() 状态变更: ${s}`);
    badge.className = "orui-badge orui-" + pos + " orui-" + s;
    label.textContent = s;
  }
  const initialStatus = wsClient.getStatus();
  logger.debug(MODULE, `初始状态: ${initialStatus}`);
  renderStatus(initialStatus);
  logger.debug(MODULE, "注册状态变更监听器");
  wsClient.onStatusChange(renderStatus);

  function positionPanel() {
    logger.debug(MODULE, `positionPanel() showDebug=${showDebug}`);
    if (!showDebug) { panel.style.display = "none"; return; }
    panel.style.left = "";
    panel.style.top = "";
    panel.style.display = "block";
    const br = badge.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    logger.debug(MODULE, `计算面板位置: 徽章=${br.left},${br.top} 面板尺寸=${pr.width}x${pr.height}`);
    // Score each side by available space, pick the one that fits best
    const sides: { score: number; top: number; left: number }[] = [];
    // above
    if (br.top - gap >= pr.height) {
      sides.push({ score: br.top, top: br.top - gap - pr.height, left: br.left + br.width / 2 - pr.width / 2 });
      logger.debug(MODULE, "面板可放置在上方");
    }
    // below
    if (vh - br.bottom - gap >= pr.height) {
      sides.push({ score: vh - br.bottom, top: br.bottom + gap, left: br.left + br.width / 2 - pr.width / 2 });
      logger.debug(MODULE, "面板可放置在下方");
    }
    // right
    if (vw - br.right - gap >= pr.width) {
      sides.push({ score: vw - br.right, top: br.top + br.height / 2 - pr.height / 2, left: br.right + gap });
      logger.debug(MODULE, "面板可放置在右侧");
    }
    // left
    if (br.left - gap >= pr.width) {
      sides.push({ score: br.left, top: br.top + br.height / 2 - pr.height / 2, left: br.left - gap - pr.width });
      logger.debug(MODULE, "面板可放置在左侧");
    }
    if (sides.length > 0) {
      const best = sides.reduce((a, b) => a.score >= b.score ? a : b);
      panel.style.left = Math.max(gap, Math.min(vw - pr.width - gap, best.left)) + "px";
      panel.style.top = Math.max(gap, Math.min(vh - pr.height - gap, best.top)) + "px";
      logger.debug(MODULE, `面板位置确定: left=${panel.style.left}, top=${panel.style.top}`);
    } else {
      // If no side fits, center in viewport
      panel.style.left = Math.max(gap, (vw - pr.width) / 2) + "px";
      panel.style.top = Math.max(gap, (vh - pr.height) / 2) + "px";
      logger.debug(MODULE, "面板居中显示");
    }
  }

  function renderPanel() {
    logger.debug(MODULE, `renderPanel() showDebug=${showDebug}`);
    if (!showDebug) { panel.style.display = "none"; return; }
    const stats = wsClient.getStats();
    logger.debug(MODULE, `获取统计信息: status=${stats.status}, latency=${stats.latency}, connects=${stats.connectCount}`);
    const statusClass =
      stats.status === "connected" ? "orui-ok"
      : stats.status === "connecting" ? "orui-warn"
      : "orui-bad";
    const logs = stats.logs.slice(-20).join("\n");
    logger.debug(MODULE, `渲染面板，日志条数: ${logs.split('\n').length}`);
    panel.innerHTML = `
      <div class="orui-title">Remote UI Debug Info</div>
      <table>
        <tr><td>Status</td><td class="${statusClass}">${stats.status}</td></tr>
        <tr><td>Latency</td><td>${stats.latency != null ? stats.latency + "ms" : "-"}</td></tr>
        <tr><td>Connects</td><td>${stats.connectCount ?? 0}</td></tr>
        <tr><td>Reconnects</td><td>${stats.reconnectCount ?? 0}</td></tr>
        <tr><td>Uptime</td><td>${stats.uptime != null ? formatUptime(stats.uptime) : "-"}</td></tr>
        <tr><td>WS URL</td><td class="orui-url">${stats.url || "-"}</td></tr>
        ${stats.lastError ? `<tr><td>Last Error</td><td class="orui-error">${stats.lastError}</td></tr>` : ""}
      </table>
      <div class="orui-log-title">Logs <button class="orui-copy-btn">Copy</button></div>
      <pre class="orui-log">${logs || "(no logs)"}</pre>`;
    // Bind copy button
    const copyBtn = panel.querySelector(".orui-copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", (e) => {
        logger.info(MODULE, "复制按钮被点击");
        e.stopPropagation();
        const fullLogs = wsClient.getStats().logs.join("\n");
        navigator.clipboard.writeText(fullLogs).then(() => {
          logger.info(MODULE, `日志已复制到剪贴板，共 ${fullLogs.split('\n').length} 行`);
        }).catch((err) => {
          logger.error(MODULE, `复制失败: ${err}`);
        });
      });
    }
    positionPanel();
  }

  // ---- drag ----
  logger.debug(MODULE, "初始化拖拽状态变量");
  let drag: { startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null = null;

  function onPointerDown(e: PointerEvent) {
    logger.debug(MODULE, `onPointerDown() 触发，button=${e.button}, pointerId=${e.pointerId}`);
    if (e.button !== 0) {
      logger.debug(MODULE, "非左键点击，忽略");
      return;
    }
    const rect = badge.getBoundingClientRect();
    logger.debug(MODULE, `徽章位置: left=${rect.left}, top=${rect.top}, width=${rect.width}, height=${rect.height}`);
    drag = {
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      moved: false,
    };
    logger.debug(MODULE, `拖拽开始: startX=${drag.startX}, startY=${drag.startY}, offsetX=${drag.offsetX}, offsetY=${drag.offsetY}`);
    badge.setPointerCapture(e.pointerId);
    logger.debug(MODULE, "指针捕获已设置");
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      if (!drag.moved) {
        logger.debug(MODULE, `拖拽移动超过阈值: dx=${dx}, dy=${dy}`);
        drag.moved = true;
      }
    }
    // Remove position class when dragging
    badge.classList.remove("orui-bottom-right", "orui-bottom-left", "orui-top-right", "orui-top-left");
    badge.style.left = (e.clientX - drag.offsetX) + "px";
    badge.style.top = (e.clientY - drag.offsetY) + "px";
    if (showDebug) positionPanel();
  }

  function onPointerUp(e: PointerEvent) {
    logger.debug(MODULE, `onPointerUp() 触发，pointerId=${e.pointerId}`);
    if (!drag) return;
    badge.releasePointerCapture(e.pointerId);
    logger.debug(MODULE, "指针捕获已释放");
    if (!drag.moved) {
      logger.info(MODULE, "检测到点击（非拖拽），切换调试面板显示");
      showDebug = !showDebug;
      if (showDebug) {
        logger.info(MODULE, "调试面板已打开");
        renderPanel();
        statsTimer = setInterval(renderPanel, 2000);
        logger.debug(MODULE, "已启动定时刷新（每 2 秒）");
      } else {
        logger.info(MODULE, "调试面板已关闭");
        panel.style.display = "none";
        if (statsTimer) {
          clearInterval(statsTimer);
          statsTimer = null;
          logger.debug(MODULE, "已停止定时刷新");
        }
      }
    } else {
      logger.debug(MODULE, "拖拽操作完成");
    }
    drag = null;
  }

  logger.debug(MODULE, "注册拖拽事件监听器");
  badge.addEventListener("pointerdown", onPointerDown);
  badge.addEventListener("pointermove", onPointerMove);
  badge.addEventListener("pointerup", onPointerUp);

  if (options?.visible === false) {
    logger.info(MODULE, "徽章初始设置为隐藏");
    badge.style.display = "none";
  } else {
    logger.info(MODULE, "徽章初始设置为可见");
  }

  // ---- destroy ----
  cleanupFloatingBadge = () => {
    logger.info(MODULE, "执行徽章清理函数");
    badge.removeEventListener("pointerdown", onPointerDown);
    badge.removeEventListener("pointermove", onPointerMove);
    badge.removeEventListener("pointerup", onPointerUp);
    if (statsTimer) {
      clearInterval(statsTimer);
      logger.debug(MODULE, "已清理定时刷新");
    }
    badge.remove();
    logger.debug(MODULE, "徽章元素已从 DOM 移除");
    cleanupFloatingBadge = null;
  };
  logger.info(MODULE, "=== initFloatingBadge() 初始化完成 ===");
  return cleanupFloatingBadge;
}

logger.info(MODULE, "=== 模块加载完成 ===");
