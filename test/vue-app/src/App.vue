<script setup lang="ts">
// Auto-install __TAURI_INTERNALS__ shim so @tauri-apps/api works in browser
import "open-tauri-remote-webview/bridge-init";

import { ref, onMounted } from "vue";
import { invoke } from "open-tauri-remote-webview/api/core";
import { listen, once } from "open-tauri-remote-webview/api/event";

// ── Globals ──────────────────────────────────────────────
const runningInTauri = ref(false);
const wsUrl = ref("");
const log = ref<string[]>([]);
const serverRunning = ref(false);
const port = ref(9090);
const count = ref(0);

function add(category: string, msg: string) {
  log.value.push(`[${category}] ${msg}`);
}

function isRealTauri(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in window
    && !("__TAURI_REMOTE_UI_SHIM__" in window);
}

// ── Categories ───────────────────────────────────────────
const categories = [
  { id: "basic", label: "基本类型", open: false },
  { id: "complex", label: "复杂类型", open: false },
  { id: "error", label: "错误处理", open: false },
  { id: "events", label: "事件", open: false },
  { id: "app", label: "应用信息", open: false },
  { id: "window", label: "窗口信息", open: false },
  { id: "counter", label: "计数器", open: false },
  { id: "notes", label: "笔记 (文件系统)", open: false },
  { id: "server", label: "远程服务器", open: false },
] as const;

type CatId = (typeof categories)[number]["id"];

// ── 1. Basic Types ──────────────────────────────────────
async function testEchoString() {
  const r = await invoke<string>("echo_string", { value: "你好 Tauri!" });
  add("basic", `echo_string("你好 Tauri!") → "${r}"`);
}

async function testAddNumbers() {
  const r = await invoke<number>("add_numbers", { a: 10, b: 20 });
  add("basic", `add_numbers(10, 20) → ${r}`);
}

async function testToBool() {
  const r = await invoke<string>("to_bool", { value: true });
  add("basic", `to_bool(true) → "${r}"`);
}

async function testEchoJson() {
  const r = await invoke<{ name: string; value: number }>("echo_json", {
    value: { name: "测试", value: 42 },
  });
  add("basic", `echo_json({name:"测试",value:42}) → ${JSON.stringify(r)}`);
}

// ── 2. Complex Types ────────────────────────────────────
async function testGetUser() {
  const r = await invoke<{ id: number; name: string; email: string; roles: string[] }>(
    "get_user",
    { id: 1 },
  );
  add("complex", `get_user(1) → id=${r.id} name=${r.name} email=${r.email} roles=${r.roles.join(",")}`);
}

async function testGetPaginated() {
  const r = await invoke<{ items: string[]; total: number; page: number }>("get_paginated");
  add("complex", `get_paginated() → page=${r.page}/${r.total} items=${r.items.length}`);
}

// ── 3. Error Handling ───────────────────────────────────
async function testAlwaysFails() {
  try {
    await invoke("always_fails");
  } catch (e) {
    add("error", `always_fails() → 捕获到错误: ${e}`);
  }
}

async function testDivideOk() {
  const r = await invoke<number>("divide", { a: 10, b: 3 });
  add("error", `divide(10, 3) → ${r}`);
}

async function testDivideByZero() {
  try {
    await invoke("divide", { a: 10, b: 0 });
  } catch (e) {
    add("error", `divide(10, 0) → 捕获到错误: "${e}"`);
  }
}

// ── 4. Events ───────────────────────────────────────────
async function testEmitAndListen() {
  const eventName = `test-event-${Date.now()}`;
  const unlisten = await listen<string>(eventName, (e) => {
    add("events", `listen("${eventName}") → 收到: "${e.payload}"`);
  });
  await invoke("trigger_event", { name: eventName, payload: "hello from invoke" });
  setTimeout(() => unlisten(), 1000);
}

async function testOnce() {
  const eventName = `once-event-${Date.now()}`;
  const unlisten = await once<string>(eventName, (e) => {
    add("events", `once("${eventName}") → 收到 (只应触发一次): "${e.payload}"`);
  });
  await invoke("trigger_event", { name: eventName, payload: "first" });
  await invoke("trigger_event", { name: eventName, payload: "second (should NOT fire)" });
  setTimeout(() => unlisten(), 500);
}

// ── 5. App Info ─────────────────────────────────────────
async function testAppInfo() {
  add("app", "请求应用信息...");
  try {
    const { getName, getVersion, getTauriVersion, getIdentifier } = await import("@tauri-apps/api/app");
    add("app", `getName() → "${await getName()}"`);
    add("app", `getVersion() → "${await getVersion()}"`);
    add("app", `getTauriVersion() → "${await getTauriVersion()}"`);
    add("app", `getIdentifier() → "${await getIdentifier()}"`);
  } catch (e) {
    add("app", `应用信息错误: ${e}`);
  }
}

// ── 6. Window Info ──────────────────────────────────────
async function testWindowInfo() {
  add("window", "请求窗口信息...");
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    add("window", `label="${win.label}"`);
    add("window", `title="${await win.title()}"`);
    add("window", `innerSize=${JSON.stringify(await win.innerSize())}`);
    add("window", `outerSize=${JSON.stringify(await win.outerSize())}`);
    add("window", `innerPosition=${JSON.stringify(await win.innerPosition())}`);
    add("window", `isVisible=${await win.isVisible()}`);
    add("window", `isMaximized=${await win.isMaximized()}`);
    add("window", `isFocused=${await win.isFocused()}`);
    add("window", `theme=${await win.theme()}`);
  } catch (e) {
    add("window", `窗口信息错误: ${e}`);
  }
}

// ── 7. Counter ──────────────────────────────────────────
async function testIncrement() {
  count.value = await invoke<number>("increment", { value: 1 });
  add("counter", `increment(1) → ${count.value}`);
}

// ── 8. Notes (FS) ───────────────────────────────────────
async function testWriteNotes() {
  await invoke("write_notes", { content: `test at ${new Date().toISOString()}` });
  add("notes", "write_notes() → done");
}

async function testReadNotes() {
  const r = await invoke<string>("read_notes");
  add("notes", `read_notes() → "${r}"`);
}

// ── 9. Remote Server ────────────────────────────────────
async function testStartServer() {
  await invoke("enable_server", { port: port.value });
  serverRunning.value = true;
  add("server", `服务器已启动 ws://0.0.0.0:${port.value}/remote_ui_ws`);
  add("server", "在另一台机器的浏览器中打开 http://<本机IP>:${port.value}");
}

async function testStopServer() {
  await invoke("disable_server");
  serverRunning.value = false;
  add("server", "服务器已停止");
}

// ── Run All ─────────────────────────────────────────────
async function runCategory(id: CatId) {
  add(id, `=== 开始 ${id} 测试 ===`);
  switch (id) {
    case "basic":
      await testEchoString();
      await testAddNumbers();
      await testToBool();
      await testEchoJson();
      break;
    case "complex":
      await testGetUser();
      await testGetPaginated();
      break;
    case "error":
      await testAlwaysFails();
      await testDivideOk();
      await testDivideByZero();
      break;
    case "events":
      await testEmitAndListen();
      await testOnce();
      break;
    case "app":
      await testAppInfo();
      break;
    case "window":
      await testWindowInfo();
      break;
    case "counter":
      await testIncrement();
      break;
    case "notes":
      await testWriteNotes();
      await testReadNotes();
      break;
    case "server":
      if (serverRunning.value) {
        await testStopServer();
      } else {
        await testStartServer();
      }
      break;
  }
  add(id, `=== ${id} 测试完成 ===`);
}

async function runAll() {
  log.value = [];
  add("system", "正在运行所有测试...");
  for (const cat of categories) {
    await runCategory(cat.id as CatId);
  }
  add("system", "所有测试完成");
}

onMounted(async () => {
  runningInTauri.value = isRealTauri();
  wsUrl.value = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/remote_ui_ws`;
  add("system", `运行环境: ${runningInTauri.value ? "Tauri WebView" : "浏览器"}`);
  add("system", `WS 端点: ${wsUrl.value}`);
  if (runningInTauri.value) {
    serverRunning.value = true;
    add("server", "WS 服务器已在启动时自动启动 (端口 9090)");
  }
  add("system", "点击分类按钮运行测试");
});
</script>

<template>
  <div class="app">
    <header>
      <h1>Tauri Remote UI — IPC 测试套件</h1>
      <div class="badge-row">
        <span :class="['badge', runningInTauri ? 'badge-tauri' : 'badge-browser']">
          {{ runningInTauri ? 'Tauri WebView' : '浏览器' }}
        </span>
        <span :class="['badge', serverRunning ? 'badge-on' : 'badge-off']">
          服务器: {{ serverRunning ? '运行中' : '已停止' }}
        </span>
      </div>
    </header>

    <section class="controls">
      <button class="btn btn-primary" @click="runAll">▶ 运行所有测试</button>
      <button class="btn" @click="log = []">清空日志</button>
    </section>

    <section class="categories">
      <div v-for="cat in categories" :key="cat.id" class="cat-card">
        <div class="cat-header">
          <strong>{{ cat.label }}</strong>
          <button class="btn btn-sm" @click="runCategory(cat.id as CatId)">运行</button>
        </div>
        <p class="cat-desc">
          <template v-if="cat.id === 'basic'">echo_string, add_numbers, to_bool, echo_json</template>
          <template v-else-if="cat.id === 'complex'">get_user (结构体), get_paginated (泛型)</template>
          <template v-else-if="cat.id === 'error'">always_fails, divide (正常 + 除零)</template>
          <template v-else-if="cat.id === 'events'">listen, once, trigger_event</template>
          <template v-else-if="cat.id === 'app'">getName, getVersion, getTauriVersion</template>
          <template v-else-if="cat.id === 'window'">title, size, position, theme 等</template>
          <template v-else-if="cat.id === 'counter'">通过 invoke 的原子计数器</template>
          <template v-else-if="cat.id === 'notes'">读写文件系统</template>
          <template v-else-if="cat.id === 'server'">启动/停止 WS 远程访问服务器</template>
        </p>
      </div>
    </section>

    <section class="log-section">
      <h2>输出日志</h2>
      <pre class="log" ref="logEl">{{ log.length ? log.join("\n") : "暂无输出，点击上方测试按钮运行。" }}</pre>
    </section>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; }
.app { max-width: 900px; margin: 0 auto; padding: 20px; }

header { margin-bottom: 20px; }
header h1 { font-size: 22px; margin-bottom: 8px; }
.badge-row { display: flex; gap: 8px; }
.badge { padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: 600; }
.badge-tauri { background: #1f6feb; color: #fff; }
.badge-browser { background: #238636; color: #fff; }
.badge-on { background: #238636; color: #fff; }
.badge-off { background: #da3633; color: #fff; }

.controls { margin-bottom: 16px; display: flex; gap: 8px; }
.btn { padding: 6px 14px; border: 1px solid #30363d; border-radius: 6px; background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 13px; }
.btn:hover { background: #30363d; }
.btn-primary { background: #238636; border-color: #2ea043; }
.btn-primary:hover { background: #2ea043; }
.btn-sm { padding: 3px 10px; font-size: 12px; }

.categories { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; margin-bottom: 20px; }
.cat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; }
.cat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.cat-desc { font-size: 12px; color: #8b949e; }

.log-section h2 { font-size: 16px; margin-bottom: 8px; }
.log { background: #010409; border: 1px solid #30363d; border-radius: 8px; padding: 12px; min-height: 200px; max-height: 500px; overflow-y: auto; font-size: 13px; line-height: 1.6; font-family: "JetBrains Mono", "Fira Code", monospace; white-space: pre-wrap; word-break: break-all; }
</style>
