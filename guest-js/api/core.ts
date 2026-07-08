import wsClient from "../src/ws.js";

let nextId = 1;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const pending = new Map<number, PendingRequest>();

export function setBaseUrl(url: string) {
  wsClient.setUrl(url);
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  const request = { id, cmd, args };

  if (!wsClient.isConnected()) {
    await wsClient.connect();
  }

  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    wsClient.send(JSON.stringify(request));
  });
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

  if ("id" in record && typeof record.id === "number") {
    const pendingReq = pending.get(record.id);
    if (!pendingReq) return;
    pending.delete(record.id);

    try {
      const payload = JSON.parse(record.payload as string);
      if (payload && typeof payload === "object" && "status" in payload) {
        if (payload.status === "success") {
          pendingReq.resolve(payload.payload);
        } else {
          pendingReq.reject(payload.payload);
        }
      } else {
        pendingReq.resolve(payload);
      }
    } catch {
      pendingReq.resolve(record.payload);
    }
  }
});
