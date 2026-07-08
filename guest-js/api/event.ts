import wsClient from "../src/ws.js";

interface EventMessage<T> {
  payload: T;
}

type EventHandler<T> = (event: EventMessage<T>) => void;

const listeners = new Map<string, Set<EventHandler<unknown>>>();

export async function listen<T>(
  event: string,
  handler: EventHandler<T>,
): Promise<() => void> {
  if (!wsClient.isConnected()) {
    await wsClient.connect();
  }

  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(handler as EventHandler<unknown>);

  return () => {
    const set = listeners.get(event);
    if (set) {
      set.delete(handler as EventHandler<unknown>);
      if (set.size === 0) {
        listeners.delete(event);
      }
    }
  };
}

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
      handler({ payload: record.payload });
    }
  }
});
