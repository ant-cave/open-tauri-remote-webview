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

let cleanupFloatingBadge: (() => void) | null = null;

export function disableFloatingBadge() {
  if (cleanupFloatingBadge) {
    cleanupFloatingBadge();
    cleanupFloatingBadge = null;
  }
}

export function initFloatingBadge(options?: FloatingBadgeOptions): () => void {
  if (typeof document === "undefined") return () => {};
  // If already initialized, clean up first
  if (cleanupFloatingBadge) cleanupFloatingBadge();

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

  document.body.append(badge);
  document.body.append(panel);

  // ---- inject styles ----
  const styleId = "orui-badge-style";
  if (!document.getElementById(styleId)) {
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
  }

  // ---- state sync ----
  function renderStatus(s: string) {
    badge.className = "orui-badge orui-" + pos + " orui-" + s;
    label.textContent = s;
  }
  renderStatus(wsClient.getStatus());
  wsClient.onStatusChange(renderStatus);

  function positionPanel() {
    if (!showDebug) { panel.style.display = "none"; return; }
    panel.style.left = "";
    panel.style.top = "";
    panel.style.display = "block";
    const br = badge.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Score each side by available space, pick the one that fits best
    const sides: { score: number; top: number; left: number }[] = [];
    // above
    if (br.top - gap >= pr.height) {
      sides.push({ score: br.top, top: br.top - gap - pr.height, left: br.left + br.width / 2 - pr.width / 2 });
    }
    // below
    if (vh - br.bottom - gap >= pr.height) {
      sides.push({ score: vh - br.bottom, top: br.bottom + gap, left: br.left + br.width / 2 - pr.width / 2 });
    }
    // right
    if (vw - br.right - gap >= pr.width) {
      sides.push({ score: vw - br.right, top: br.top + br.height / 2 - pr.height / 2, left: br.right + gap });
    }
    // left
    if (br.left - gap >= pr.width) {
      sides.push({ score: br.left, top: br.top + br.height / 2 - pr.height / 2, left: br.left - gap - pr.width });
    }
    if (sides.length > 0) {
      const best = sides.reduce((a, b) => a.score >= b.score ? a : b);
      panel.style.left = Math.max(gap, Math.min(vw - pr.width - gap, best.left)) + "px";
      panel.style.top = Math.max(gap, Math.min(vh - pr.height - gap, best.top)) + "px";
    } else {
      // If no side fits, center in viewport
      panel.style.left = Math.max(gap, (vw - pr.width) / 2) + "px";
      panel.style.top = Math.max(gap, (vh - pr.height) / 2) + "px";
    }
  }

  function renderPanel() {
    if (!showDebug) { panel.style.display = "none"; return; }
    const stats = wsClient.getStats();
    const statusClass =
      stats.status === "connected" ? "orui-ok"
      : stats.status === "connecting" ? "orui-warn"
      : "orui-bad";
    const logs = stats.logs.slice(-20).join("\n");
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
        e.stopPropagation();
        const fullLogs = wsClient.getStats().logs.join("\n");
        navigator.clipboard.writeText(fullLogs).catch(() => {});
      });
    }
    positionPanel();
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
    if (showDebug) positionPanel();
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
  cleanupFloatingBadge = () => {
    badge.removeEventListener("pointerdown", onPointerDown);
    badge.removeEventListener("pointermove", onPointerMove);
    badge.removeEventListener("pointerup", onPointerUp);
    if (statsTimer) clearInterval(statsTimer);
    badge.remove();
    cleanupFloatingBadge = null;
  };
  return cleanupFloatingBadge;
}
