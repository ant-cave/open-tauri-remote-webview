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
logger.info(MODULE, "=== module loading ===");

function formatUptime(ms: number): string {
  logger.debug(MODULE, `formatUptime() input: ${ms}ms`);
  if (ms < 1000) {
    const result = ms + "ms";
    logger.debug(MODULE, `formatUptime() output: ${result}`);
    return result;
  }
  if (ms < 60000) {
    const result = (ms / 1000).toFixed(1) + "s";
    logger.debug(MODULE, `formatUptime() output: ${result}`);
    return result;
  }
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const result = m + "m " + s + "s";
  logger.debug(MODULE, `formatUptime() output: ${result}`);
  return result;
}

export interface FloatingBadgeOptions {
  /** Position preset. Default: "bottom-right" */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** Whether to start visible. Default: true */
  visible?: boolean;
}

let cleanupFloatingBadge: (() => void) | null = null;
logger.debug(MODULE, "cleanupFloatingBadge variable initialized");

export function disableFloatingBadge() {
  logger.info(MODULE, ">>> disableFloatingBadge() called");
  if (cleanupFloatingBadge) {
    logger.debug(MODULE, "executing cleanup function");
    cleanupFloatingBadge();
    cleanupFloatingBadge = null;
    logger.info(MODULE, "floating badge disabled and cleaned up");
  } else {
    logger.debug(MODULE, "no cleanup function to execute (badge not initialized)");
  }
}

export function initFloatingBadge(options?: FloatingBadgeOptions): () => void {
  logger.info(MODULE, ">>> initFloatingBadge() executing");
  logger.debug(MODULE, `options: ${JSON.stringify(options)}`);

  if (typeof document === "undefined") {
    logger.warn(MODULE, "document object not found, skipping initialization");
    return () => {};
  }
  logger.debug(MODULE, "document object check passed");

  // If already initialized, clean up first
  if (cleanupFloatingBadge) {
    logger.info(MODULE, "existing badge instance detected, performing cleanup");
    cleanupFloatingBadge();
  }

  const pos = options?.position ?? "bottom-right";
  logger.debug(MODULE, `badge position set to: ${pos}`);
  let showDebug = false;
  let statsTimer: ReturnType<typeof setInterval> | null = null;

  // ---- create elements ----
  logger.debug(MODULE, "creating badge DOM elements");
  const badge = document.createElement("div");
  badge.className = "orui-badge orui-" + pos;
  logger.debug(MODULE, `badge element created, className: ${badge.className}`);

  const dot = document.createElement("span");
  dot.className = "orui-dot";
  const label = document.createElement("span");
  label.className = "orui-label";
  badge.append(dot, label);
  logger.debug(MODULE, "badge inner elements (dot and label) created and appended");

  const panel = document.createElement("div");
  panel.className = "orui-panel";
  panel.style.display = "none";
  logger.debug(MODULE, "debug panel element created (initially hidden)");

  document.body.append(badge);
  document.body.append(panel);
  logger.info(MODULE, "badge and panel added to DOM");

  // ---- inject styles ----
  const styleId = "orui-badge-style";
  logger.debug(MODULE, `checking if styles are injected (styleId: ${styleId})`);
  if (!document.getElementById(styleId)) {
    logger.info(MODULE, "styles not injected, creating and injecting stylesheet");
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
    logger.info(MODULE, "stylesheet injection complete");
  } else {
    logger.debug(MODULE, "stylesheet already exists, skipping injection");
  }

  // ---- state sync ----
  logger.info(MODULE, "initializing status sync");
  function renderStatus(s: string) {
    logger.debug(MODULE, `renderStatus() status changed: ${s}`);
    badge.className = "orui-badge orui-" + pos + " orui-" + s;
    label.textContent = s;
  }
  const initialStatus = wsClient.getStatus();
  logger.debug(MODULE, `initial status: ${initialStatus}`);
  renderStatus(initialStatus);
  logger.debug(MODULE, "registering status change listener");
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
    logger.debug(MODULE, `calculating panel position: badge=${br.left},${br.top} panel size=${pr.width}x${pr.height}`);
    // Score each side by available space, pick the one that fits best
    const sides: { score: number; top: number; left: number }[] = [];
    // above
    if (br.top - gap >= pr.height) {
      sides.push({ score: br.top, top: br.top - gap - pr.height, left: br.left + br.width / 2 - pr.width / 2 });
      logger.debug(MODULE, "panel can be placed above");
    }
    // below
    if (vh - br.bottom - gap >= pr.height) {
      sides.push({ score: vh - br.bottom, top: br.bottom + gap, left: br.left + br.width / 2 - pr.width / 2 });
      logger.debug(MODULE, "panel can be placed below");
    }
    // right
    if (vw - br.right - gap >= pr.width) {
      sides.push({ score: vw - br.right, top: br.top + br.height / 2 - pr.height / 2, left: br.right + gap });
      logger.debug(MODULE, "panel can be placed on the right");
    }
    // left
    if (br.left - gap >= pr.width) {
      sides.push({ score: br.left, top: br.top + br.height / 2 - pr.height / 2, left: br.left - gap - pr.width });
      logger.debug(MODULE, "panel can be placed on the left");
    }
    if (sides.length > 0) {
      const best = sides.reduce((a, b) => a.score >= b.score ? a : b);
      panel.style.left = Math.max(gap, Math.min(vw - pr.width - gap, best.left)) + "px";
      panel.style.top = Math.max(gap, Math.min(vh - pr.height - gap, best.top)) + "px";
      logger.debug(MODULE, `panel position set: left=${panel.style.left}, top=${panel.style.top}`);
    } else {
      // If no side fits, center in viewport
      panel.style.left = Math.max(gap, (vw - pr.width) / 2) + "px";
      panel.style.top = Math.max(gap, (vh - pr.height) / 2) + "px";
      logger.debug(MODULE, "panel centered");
    }
  }

  function renderPanel() {
    logger.debug(MODULE, `renderPanel() showDebug=${showDebug}`);
    if (!showDebug) { panel.style.display = "none"; return; }
    const stats = wsClient.getStats();
    logger.debug(MODULE, `fetching stats: status=${stats.status}, latency=${stats.latency}, connects=${stats.connectCount}`);
    const statusClass =
      stats.status === "connected" ? "orui-ok"
      : stats.status === "connecting" ? "orui-warn"
      : "orui-bad";
    const logs = stats.logs.slice(-20).join("\n");
    logger.debug(MODULE, `rendering panel, log lines: ${logs.split('\n').length}`);
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
        logger.info(MODULE, "copy button clicked");
        e.stopPropagation();
        const fullLogs = wsClient.getStats().logs.join("\n");
        navigator.clipboard.writeText(fullLogs).then(() => {
          logger.info(MODULE, `logs copied to clipboard, ${fullLogs.split('\n').length} lines`);
        }).catch((err) => {
          logger.error(MODULE, `copy failed: ${err}`);
        });
      });
    }
    positionPanel();
  }

  // ---- drag ----
  logger.debug(MODULE, "initializing drag state variables");
  let drag: { startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null = null;

  function onPointerDown(e: PointerEvent) {
    logger.debug(MODULE, `onPointerDown() fired, button=${e.button}, pointerId=${e.pointerId}`);
    if (e.button !== 0) {
      logger.debug(MODULE, "non-left click, ignoring");
      return;
    }
    const rect = badge.getBoundingClientRect();
    logger.debug(MODULE, `badge position: left=${rect.left}, top=${rect.top}, width=${rect.width}, height=${rect.height}`);
    drag = {
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      moved: false,
    };
    logger.debug(MODULE, `drag start: startX=${drag.startX}, startY=${drag.startY}, offsetX=${drag.offsetX}, offsetY=${drag.offsetY}`);
    badge.setPointerCapture(e.pointerId);
    logger.debug(MODULE, "pointer capture set");
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      if (!drag.moved) {
        logger.debug(MODULE, `drag movement exceeded threshold: dx=${dx}, dy=${dy}`);
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
    logger.debug(MODULE, `onPointerUp() fired, pointerId=${e.pointerId}`);
    if (!drag) return;
    badge.releasePointerCapture(e.pointerId);
    logger.debug(MODULE, "pointer capture released");
    if (!drag.moved) {
      logger.info(MODULE, "click detected (not drag), toggling debug panel");
      showDebug = !showDebug;
      if (showDebug) {
        logger.info(MODULE, "debug panel opened");
        renderPanel();
        statsTimer = setInterval(renderPanel, 2000);
        logger.debug(MODULE, "started periodic refresh (every 2s)");
      } else {
        logger.info(MODULE, "debug panel closed");
        panel.style.display = "none";
        if (statsTimer) {
          clearInterval(statsTimer);
          statsTimer = null;
          logger.debug(MODULE, "stopped periodic refresh");
        }
      }
    } else {
      logger.debug(MODULE, "drag operation completed");
    }
    drag = null;
  }

  logger.debug(MODULE, "registering drag event listeners");
  badge.addEventListener("pointerdown", onPointerDown);
  badge.addEventListener("pointermove", onPointerMove);
  badge.addEventListener("pointerup", onPointerUp);

  if (options?.visible === false) {
    logger.info(MODULE, "badge initially hidden");
    badge.style.display = "none";
  } else {
    logger.info(MODULE, "badge initially visible");
  }

  // ---- destroy ----
  cleanupFloatingBadge = () => {
    logger.info(MODULE, "executing badge cleanup function");
    badge.removeEventListener("pointerdown", onPointerDown);
    badge.removeEventListener("pointermove", onPointerMove);
    badge.removeEventListener("pointerup", onPointerUp);
    if (statsTimer) {
      clearInterval(statsTimer);
      logger.debug(MODULE, "periodic refresh cleaned up");
    }
    badge.remove();
    logger.debug(MODULE, "badge element removed from DOM");
    cleanupFloatingBadge = null;
  };
  logger.info(MODULE, "=== initFloatingBadge() initialization complete ===");
  return cleanupFloatingBadge;
}

logger.info(MODULE, "=== module loading complete ===");
