// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
//
// Based on https://crates.io/crates/tauri-remote-ui/0.14.0 by DraviaVemal (MIT).
// See LICENSE file in the root directory.

/**
 * Floating WS connection status badge with drag support and debug panel.
 *
 * Usage:
 *   import { initFloatingBadge } from "open-tauri-remote-ui/api/core"
 *   initFloatingBadge()
 */

import wsClient from "./ws.js";
import { getWsStats, getWsStatus, onWsStatusChange } from "../api/core.js";

function formatUptime(ms: number): string {
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m + "m " + s + "s";
}

export interface FloatingBadgeOptions {
  /** Position preset. Default: "bottom-right" */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** Whether to start visible. Default: true */
  visible?: boolean;
}

export function initFloatingBadge(options?: FloatingBadgeOptions): () => void {
  if (typeof document === "undefined") return () => {};

  const pos = options?.position ?? "bottom-right";
  let showDebug = false;
  let statsTimer: ReturnType<typeof setInterval> | null = null;

  // ---- create elements ----
  const badge = document.createElement("div");
  badge.className = "orui-badge orui-" + pos;

  const dot = document.createElement("span");
  dot.className = "orui-dot";
  const label = document.createElement("span");
  label.className = "orui-label";
  badge.append(dot, label);

  const panel = document.createElement("div");
  panel.className = "orui-panel";
  panel.style.display = "none";
  badge.append(panel);

  document.body.append(badge);

  // ---- inject styles ----
  const styleId = "orui-badge-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
.orui-badge {
  position: fixed;
  z-index: 99999;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 10px;
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
}

.orui-panel {
  position: absolute;
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
.orui-bottom-right .orui-panel,
.orui-bottom-left .orui-panel { bottom: calc(100% + 6px); }
.orui-top-right .orui-panel,
.orui-top-left .orui-panel { top: calc(100% + 6px); }
.orui-bottom-right .orui-panel,
.orui-top-right .orui-panel { right: 0; }
.orui-bottom-left .orui-panel,
.orui-top-left .orui-panel { left: 0; }

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
`;
    document.head.append(style);
  }

  // ---- state sync ----
  function renderStatus(s: string) {
    badge.className = "orui-badge orui-" + pos + " orui-" + s;
    label.textContent = s;
  }
  renderStatus(getWsStatus());
  onWsStatusChange(renderStatus);

  function renderPanel() {
    if (!showDebug) { panel.style.display = "none"; return; }
    panel.style.display = "block";
    const stats = getWsStats();
    const statusClass =
      stats.status === "connected" ? "orui-ok"
      : stats.status === "connecting" ? "orui-warn"
      : "orui-bad";
    panel.innerHTML = `
      <div class="orui-title">WebSocket 调试信息</div>
      <table>
        <tr><td>状态</td><td class="${statusClass}">${stats.status}</td></tr>
        <tr><td>延迟</td><td>${stats.latency != null ? stats.latency + "ms" : "-"}</td></tr>
        <tr><td>连接次数</td><td>${stats.connectCount ?? 0}</td></tr>
        <tr><td>重连次数</td><td>${stats.reconnectCount ?? 0}</td></tr>
        <tr><td>在线时长</td><td>${stats.uptime != null ? formatUptime(stats.uptime) : "-"}</td></tr>
        <tr><td>WS 地址</td><td class="orui-url">${stats.url || "-"}</td></tr>
        ${stats.lastError ? `<tr><td>最后错误</td><td class="orui-error">${stats.lastError}</td></tr>` : ""}
      </table>`;
  }

  // ---- drag ----
  let drag: { startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null = null;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const rect = badge.getBoundingClientRect();
    drag = {
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      moved: false,
    };
    badge.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    // Remove position class when dragging
    badge.classList.remove("orui-bottom-right", "orui-bottom-left", "orui-top-right", "orui-top-left");
    badge.style.left = (e.clientX - drag.offsetX) + "px";
    badge.style.top = (e.clientY - drag.offsetY) + "px";
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    badge.releasePointerCapture(e.pointerId);
    if (!drag.moved) {
      showDebug = !showDebug;
      if (showDebug) {
        renderPanel();
        statsTimer = setInterval(renderPanel, 2000);
      } else {
        panel.style.display = "none";
        if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
      }
    }
    drag = null;
  }

  badge.addEventListener("pointerdown", onPointerDown);
  badge.addEventListener("pointermove", onPointerMove);
  badge.addEventListener("pointerup", onPointerUp);

  if (options?.visible === false) {
    badge.style.display = "none";
  }

  // ---- destroy ----
  return () => {
    badge.removeEventListener("pointerdown", onPointerDown);
    badge.removeEventListener("pointermove", onPointerMove);
    badge.removeEventListener("pointerup", onPointerUp);
    if (statsTimer) clearInterval(statsTimer);
    badge.remove();
  };
}
