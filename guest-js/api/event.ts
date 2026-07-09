// MIT License
// Copyright (c) 2025 DraviaVemal
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import { addEventListener } from "../src/ws-event.js";

interface EventMessage<T> {
  payload: T;
}

type EventHandler<T> = (event: EventMessage<T>) => void;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function tauriListen<T>(event: string, handler: EventHandler<T>): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, handler);
}

export async function listen<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<() => void> {
  if (isTauri()) {
    return tauriListen<T>(event, handler);
  }

  return addEventListener(event, (payload: unknown) => {
    handler({ payload: payload as T });
  });
}

async function tauriOnce<T>(event: string, handler: EventHandler<T>): Promise<() => void> {
  const { once } = await import("@tauri-apps/api/event");
  return once<T>(event, handler);
}

export async function once<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<() => void> {
  if (isTauri()) {
    return tauriOnce<T>(event, handler);
  }

  let unlisten: (() => void) | null = null;

  const wrappedHandler = (payload: unknown) => {
    handler({ payload: payload as T });
    if (unlisten) {
      unlisten();
    }
  };

  unlisten = addEventListener(event, wrappedHandler);
  return unlisten;
}
