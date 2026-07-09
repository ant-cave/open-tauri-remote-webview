// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import wsClient from "./ws.js";

const listeners = new Map<string, Set<(payload: unknown) => void>>();

wsClient.onMessage((data: string) => {
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }

  if (typeof msg !== "object" || msg === null) return;

  const record = msg as Record<string, unknown>;

  if ("event" in record && typeof record.event === "string") {
    const set = listeners.get(record.event);
    if (!set) return;
    for (const handler of set) {
      handler(record.payload);
    }
  }
});

export function addEventListener(event: string, handler: (payload: unknown) => void): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(handler);

  // Ensure WS is connected so events can arrive (noop if already open)
  wsClient.connect();

  return () => {
    const set = listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        listeners.delete(event);
      }
    }
  };
}
