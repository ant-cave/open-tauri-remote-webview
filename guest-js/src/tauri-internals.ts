import { wsInvoke } from "./ws-invoke.js";
import { addEventListener } from "./ws-event.js";

/**
 * Manages callback IDs mapping for the __TAURI_INTERNALS__ shim.
 * Used by @tauri-apps/api internally for event listen/unlisten, Channel, etc.
 */
class ShimCallbackManager {
  private callbacks = new Map<number, (data: unknown) => void>();
  private nextId = 1;

  transformCallback<T = unknown>(
    callback?: (response: T) => void,
    once?: boolean,
  ): number {
    const id = this.nextId++;
    this.callbacks.set(id, (data: unknown) => {
      if (once) {
        this.callbacks.delete(id);
      }
      if (callback) {
        callback(data as T);
      }
    });
    return id;
  }

  unregisterCallback(id: number): void {
    this.callbacks.delete(id);
  }

  runCallback(id: number, data: unknown): void {
    const cb = this.callbacks.get(id);
    if (cb) {
      cb(data);
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
  if (typeof window === "undefined") return;

  // Already has a real Tauri runtime or shim already installed
  if ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) {
    return;
  }

  const callbacks = new ShimCallbackManager();

  // Per-event, per-handlerId cleanup functions for intercepted plugin:event|listen
  const handlerCleanups = new Map<string, Map<number, () => void>>();

  // ── Intercepted commands ─────────────────────────────────
  // plugin:event|listen  →  register via WS event system
  // plugin:event|unlisten  →  unregister from WS event system
  // (everything else passes through to wsInvoke)

  const shim = {
    invoke: async <T>(
      cmd: string,
      args?: Record<string, unknown>,
      _options?: Record<string, unknown>,
    ): Promise<T> => {
      if (cmd === "plugin:event|listen") {
        const event = args?.event as string;
        const handlerId = args?.handler as number;
        if (event && handlerId) {
          const unlisten = addEventListener(event, (payload: unknown) => {
            // Wrap in { payload: ... } to match @tauri-apps/api/event convention
            callbacks.runCallback(handlerId, { payload });
          });
          if (!handlerCleanups.has(event)) {
            handlerCleanups.set(event, new Map());
          }
          handlerCleanups.get(event)!.set(handlerId, unlisten);
        }
        return undefined as T;
      }

      if (cmd === "plugin:event|unlisten") {
        const event = args?.event as string;
        const eventId = args?.eventId as number;
        if (event && eventId) {
          const cleanups = handlerCleanups.get(event);
          const unlisten = cleanups?.get(eventId);
          if (unlisten) {
            unlisten();
            cleanups?.delete(eventId);
          }
        }
        return undefined as T;
      }

      return wsInvoke<T>(cmd, args);
    },

    transformCallback: callbacks.transformCallback.bind(callbacks),
    unregisterCallback: callbacks.unregisterCallback.bind(callbacks),
    runCallback: callbacks.runCallback.bind(callbacks),

    convertFileSrc: (filePath: string, _protocol?: string): string => {
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

  // Mark this as a shim so apps can distinguish from real Tauri runtime
  (window as unknown as Record<string, unknown>).__TAURI_REMOTE_UI_SHIM__ = true;

  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = shim;

  (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event: string, eventId: number) => {
      callbacks.unregisterCallback(eventId);
    },
  };
}
