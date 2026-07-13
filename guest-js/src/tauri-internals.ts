// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import { wsInvoke } from "./ws-invoke.js";
import { addEventListener } from "./ws-event.js";
import * as logger from "./logger.js";

const MODULE = "tauri-internals";
logger.info(MODULE, "=== module loading ===");

/**
 * Manages callback IDs mapping for the __TAURI_INTERNALS__ shim.
 * Used by @tauri-apps/api internally for event listen/unlisten, Channel, etc.
 */
class ShimCallbackManager {
  private callbacks = new Map<number, (data: unknown) => void>();
  private nextId = 1;

  constructor() {
    logger.debug(MODULE, "ShimCallbackManager instance created");
  }

  transformCallback<T = unknown>(
    callback?: (response: T) => void,
    once?: boolean,
  ): number {
    const id = this.nextId++;
    logger.debug(MODULE, `transformCallback() register callback [id=${id}, once=${once}]`);
    this.callbacks.set(id, (data: unknown) => {
      logger.debug(MODULE, `executing callback [id=${id}]`);
      if (once) {
        logger.debug(MODULE, `callback marked as once, removing after execution [id=${id}]`);
        this.callbacks.delete(id);
      }
      if (callback) {
        try {
          callback(data as T);
          logger.debug(MODULE, `callback executed successfully [id=${id}]`);
        } catch (err) {
          logger.error(MODULE, `callback execution error [id=${id}]: ${err}`);
        }
      }
    });
    logger.debug(MODULE, `total callbacks: ${this.callbacks.size}`);
    return id;
  }

  unregisterCallback(id: number): void {
    logger.debug(MODULE, `unregisterCallback() [id=${id}]`);
    const existed = this.callbacks.has(id);
    this.callbacks.delete(id);
    logger.debug(MODULE, `callback removal ${existed ? "succeeded" : "failed (not found)"} [id=${id}], remaining callbacks: ${this.callbacks.size}`);
  }

  runCallback(id: number, data: unknown): void {
    logger.debug(MODULE, `runCallback() [id=${id}]`);
    const cb = this.callbacks.get(id);
    if (cb) {
      logger.debug(MODULE, `callback found, executing [id=${id}]`);
      cb(data);
    } else {
      logger.warn(MODULE, `callback not found [id=${id}]`);
    }
  }
}

/**
 * Installs `window.__TAURI_INTERNALS__` and `window.__TAURI_EVENT_PLUGIN_INTERNALS__`
 * in the browser context so that `@tauri-apps/api` modules work transparently
 * over the WebSocket bridge.
 *
 * Call this once before any `@tauri-apps/api` imports are used.
 */
export function installTauriBridge(): void {
  logger.info(MODULE, ">>> installTauriBridge() executing");

  if (typeof window === "undefined") {
    logger.warn(MODULE, "window object not found, skipping installation");
    return;
  }
  logger.debug(MODULE, "window object check passed");

  // Already has a real Tauri runtime or shim already installed
  if ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) {
    logger.warn(MODULE, "__TAURI_INTERNALS__ already exists, skipping installation (native Tauri or shim already installed)");
    return;
  }
  logger.debug(MODULE, "__TAURI_INTERNALS__ not found, continuing installation");

  logger.info(MODULE, "creating ShimCallbackManager instance");
  const callbacks = new ShimCallbackManager();

  // Per-event, per-handlerId cleanup functions for intercepted plugin:event|listen
  logger.debug(MODULE, "initializing handlerCleanups map");
  const handlerCleanups = new Map<string, Map<number, () => void>>();

  // ── Intercepted commands ─────────────────────────────────
  // plugin:event|listen  →  register via WS event system
  // plugin:event|unlisten  →  unregister from WS event system
  // (everything else passes through to wsInvoke)

  logger.info(MODULE, "building shim object...");

  const shim = {
    invoke: async <T>(
      cmd: string,
      args?: Record<string, unknown>,
      _options?: Record<string, unknown>,
    ): Promise<T> => {
      logger.info(MODULE, `shim.invoke() [cmd="${cmd}"]`);
      logger.debug(MODULE, `shim.invoke() args: ${JSON.stringify(args)}`);

      if (cmd === "plugin:event|listen") {
        logger.info(MODULE, "intercepted plugin:event|listen command");
        const event = args?.event as string;
        const handlerId = args?.handler as number;
        logger.debug(MODULE, `event name: "${event}", handlerId: ${handlerId}`);

        if (event && handlerId) {
          logger.info(MODULE, `registering event listener: event="${event}", handlerId=${handlerId}`);
          const unlisten = addEventListener(event, (payload: unknown) => {
            logger.debug(MODULE, `event "${event}" triggered, invoking callback [handlerId=${handlerId}]`);
            // Wrap in { payload: ... } to match @tauri-apps/api/event convention
            callbacks.runCallback(handlerId, { payload });
          });
          if (!handlerCleanups.has(event)) {
            logger.debug(MODULE, `creating cleanup function map for event "${event}"`);
            handlerCleanups.set(event, new Map());
          }
          handlerCleanups.get(event)!.set(handlerId, unlisten);
          logger.debug(MODULE, `cleanup function registered for event "${event}" [handlerId=${handlerId}]`);
        } else {
          logger.warn(MODULE, `plugin:event|listen incomplete params: event=${event}, handlerId=${handlerId}`);
        }
        logger.info(MODULE, "plugin:event|listen processed, returning undefined");
        return undefined as T;
      }

      if (cmd === "plugin:event|unlisten") {
        logger.info(MODULE, "intercepted plugin:event|unlisten command");
        const event = args?.event as string;
        const eventId = args?.eventId as number;
        logger.debug(MODULE, `event name: "${event}", eventId: ${eventId}`);

        if (event && eventId) {
          logger.info(MODULE, `unlisten event: event="${event}", eventId=${eventId}`);
          const cleanups = handlerCleanups.get(event);
          const unlisten = cleanups?.get(eventId);
          if (unlisten) {
            logger.debug(MODULE, `cleanup function found, executing unlisten [event="${event}", eventId=${eventId}]`);
            unlisten();
            cleanups?.delete(eventId);
            logger.debug(MODULE, `cleanup function executed and removed [event="${event}", eventId=${eventId}]`);
          } else {
            logger.warn(MODULE, `cleanup function not found [event="${event}", eventId=${eventId}]`);
          }
        } else {
          logger.warn(MODULE, `plugin:event|unlisten incomplete params: event=${event}, eventId=${eventId}`);
        }
        logger.info(MODULE, "plugin:event|unlisten processed, returning undefined");
        return undefined as T;
      }

      logger.info(MODULE, `regular command, forwarding to wsInvoke: cmd="${cmd}"`);
      const result = await wsInvoke<T>(cmd, args);
      logger.info(MODULE, `wsInvoke call completed: cmd="${cmd}"`);
      return result;
    },

    transformCallback: callbacks.transformCallback.bind(callbacks),
    unregisterCallback: callbacks.unregisterCallback.bind(callbacks),
    runCallback: callbacks.runCallback.bind(callbacks),

    convertFileSrc: (filePath: string, _protocol?: string): string => {
      logger.debug(MODULE, `convertFileSrc() [filePath="${filePath}", protocol=${_protocol || "unspecified"}]`);
      logger.debug(MODULE, `convertFileSrc() returning raw path: "${filePath}"`);
      return filePath;
    },

    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },

    plugins: {
      path: {
        sep: navigator.platform.includes("Win") ? "\\" : "/",
        delimiter: navigator.platform.includes("Win") ? ";" : ":",
      },
    },
  };

  logger.debug(MODULE, "shim object built");
  logger.debug(MODULE, `shim.metadata: ${JSON.stringify(shim.metadata)}`);
  logger.debug(MODULE, `shim.plugins.path: ${JSON.stringify(shim.plugins.path)}`);

  // Mark this as a shim so apps can distinguish from real Tauri runtime
  logger.info(MODULE, "setting __TAURI_REMOTE_UI_SHIM__ = true (marking as shim environment)");
  (window as unknown as Record<string, unknown>).__TAURI_REMOTE_UI_SHIM__ = true;

  logger.info(MODULE, "installing __TAURI_INTERNALS__ on window object");
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = shim;
  logger.debug(MODULE, "__TAURI_INTERNALS__ installation complete");

  logger.info(MODULE, "installing __TAURI_EVENT_PLUGIN_INTERNALS__ on window object");
  (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event: string, eventId: number) => {
      logger.debug(MODULE, `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener() [event="${_event}", eventId=${eventId}]`);
      callbacks.unregisterCallback(eventId);
    },
  };
  logger.debug(MODULE, "__TAURI_EVENT_PLUGIN_INTERNALS__ installation complete");

  logger.info(MODULE, "=== installTauriBridge() completed ===");
  logger.info(MODULE, "Tauri Bridge Shim successfully installed in browser environment");
}

logger.info(MODULE, "=== module loading complete ===");
