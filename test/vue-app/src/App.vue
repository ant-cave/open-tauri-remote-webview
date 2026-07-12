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
interface TestResult {
  passed: number;
  failed: number;
  total: number;
}
const results = ref<Record<string, TestResult>>({});

const categories = [
  { id: "basic", label: "基本类型", open: false },
  { id: "complex", label: "复杂类型", open: false },
  { id: "error", label: "错误处理", open: false },
  { id: "events", label: "事件", open: false },
  { id: "rust-events", label: "Rust 端事件触发", open: false },
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

async function testListenUnlisten() {
  const eventName = `unlisten-test-${Date.now()}`;
  let receivedCount = 0;
  const unlisten = await listen<string>(eventName, () => {
    receivedCount++;
  });
  await invoke("trigger_event", { name: eventName, payload: "before unlisten" });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
  await invoke("trigger_event", { name: eventName, payload: "after unlisten" });
  await new Promise((r) => setTimeout(r, 100));
  add("events", `unlisten 测试: 取消监听后收到 ${receivedCount} 次 (应为 1)`);
}

async function testMultipleListeners() {
  const eventName = `multi-listener-${Date.now()}`;
  let count1 = 0;
  let count2 = 0;
  const unlisten1 = await listen<string>(eventName, () => { count1++; });
  const unlisten2 = await listen<string>(eventName, () => { count2++; });
  await invoke("trigger_event", { name: eventName, payload: "broadcast" });
  await new Promise((r) => setTimeout(r, 100));
  add("events", `多监听器: listener1=${count1}, listener2=${count2} (均应为 1)`);
  unlisten1();
  unlisten2();
}

async function testStringPayload() {
  const eventName = `payload-str-${Date.now()}`;
  const unlisten = await listen<string>(eventName, (e) => {
    add("events", `string payload: "${e.payload}" (type=${typeof e.payload})`);
  });
  await invoke("emit_event_with_string", { name: eventName, payload: "hello string" });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testNumberPayload() {
  const eventName = `payload-num-${Date.now()}`;
  const unlisten = await listen<number>(eventName, (e) => {
    add("events", `number payload: ${e.payload} (type=${typeof e.payload})`);
  });
  await invoke("emit_event_with_number", { name: eventName, payload: 3.14 });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testObjectPayload() {
  const eventName = `payload-obj-${Date.now()}`;
  const unlisten = await listen<Record<string, unknown>>(eventName, (e) => {
    add("events", `object payload: ${JSON.stringify(e.payload)}`);
  });
  await invoke("emit_event_with_object", { name: eventName, payload: { key: "value", num: 42 } });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testArrayPayload() {
  const eventName = `payload-arr-${Date.now()}`;
  const unlisten = await listen<unknown[]>(eventName, (e) => {
    add("events", `array payload: ${JSON.stringify(e.payload)} (length=${(e.payload as unknown[]).length})`);
  });
  await invoke("emit_event_with_array", { name: eventName, payload: [1, "two", true, null] });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testNullPayload() {
  const eventName = `payload-null-${Date.now()}`;
  const unlisten = await listen<null>(eventName, (e) => {
    add("events", `null payload: ${JSON.stringify(e.payload)}`);
  });
  await invoke("emit_simple_event", { name: eventName });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

// ── 4b. Rust-side Event Trigger Tests ───────────────────
async function testRustEmitSimple() {
  const eventName = `rust-simple-${Date.now()}`;
  const unlisten = await listen(eventName, (e) => {
    add("rust-events", `简单事件: ${JSON.stringify(e.payload)}`);
  });
  await invoke("emit_simple_event", { name: eventName });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testRustEmitString() {
  const eventName = `rust-str-${Date.now()}`;
  const unlisten = await listen<string>(eventName, (e) => {
    add("rust-events", `字符串事件: "${e.payload}"`);
  });
  await invoke("emit_event_with_string", { name: eventName, payload: "来自 Rust 的问候" });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testRustEmitNumber() {
  const eventName = `rust-num-${Date.now()}`;
  const unlisten = await listen<number>(eventName, (e) => {
    add("rust-events", `数字事件: ${e.payload}`);
  });
  await invoke("emit_event_with_number", { name: eventName, payload: 42.5 });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testRustEmitBool() {
  const eventName = `rust-bool-${Date.now()}`;
  const unlisten = await listen<boolean>(eventName, (e) => {
    add("rust-events", `布尔事件: ${e.payload}`);
  });
  await invoke("emit_event_with_bool", { name: eventName, payload: true });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testRustEmitObject() {
  const eventName = `rust-obj-${Date.now()}`;
  const unlisten = await listen<Record<string, unknown>>(eventName, (e) => {
    add("rust-events", `对象事件: ${JSON.stringify(e.payload)}`);
  });
  await invoke("emit_event_with_object", { name: eventName, payload: { user: "test", score: 100 } });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testRustEmitArray() {
  const eventName = `rust-arr-${Date.now()}`;
  const unlisten = await listen<unknown[]>(eventName, (e) => {
    add("rust-events", `数组事件: ${JSON.stringify(e.payload)}`);
  });
  await invoke("emit_event_with_array", { name: eventName, payload: ["a", "b", "c"] });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testRustEmitNested() {
  const eventName = `rust-nested-${Date.now()}`;
  const unlisten = await listen<Record<string, unknown>>(eventName, (e) => {
    add("rust-events", `嵌套事件: ${JSON.stringify(e.payload)}`);
  });
  await invoke("emit_event_with_nested", {
    name: eventName,
    payload: { level1: { level2: { level3: "deep" } }, arr: [1, 2, 3] },
  });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testRustEmitToWindow() {
  const eventName = `rust-to-window-${Date.now()}`;
  const unlisten = await listen<string>(eventName, (e) => {
    add("rust-events", `定向到 main 窗口: "${e.payload}"`);
  });
  await invoke("emit_to_specific_window", {
    windowLabel: "main",
    name: eventName,
    payload: "targeted message",
  });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testRustEmitToAll() {
  const eventName = `rust-to-all-${Date.now()}`;
  const unlisten = await listen<string>(eventName, (e) => {
    add("rust-events", `广播到所有窗口: "${e.payload}"`);
  });
  await invoke("emit_to_all_windows", { name: eventName, payload: "broadcast message" });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testEmitFromWindow() {
  const eventName = `window-emit-${Date.now()}`;
  const unlisten = await listen<string>(eventName, (e) => {
    add("rust-events", `Window<R> EmitterExt 发射: "${e.payload}"`);
  });
  await invoke("emit_from_window", { name: eventName, payload: "via Window::emit" });
  await new Promise((r) => setTimeout(r, 100));
  unlisten();
}

async function testRustEmitMultiple() {
  const events: [string, string][] = [];
  const received: string[] = [];
  for (let i = 0; i < 3; i++) {
    const name = `rust-multi-${i}-${Date.now()}`;
    events.push([name, `msg-${i}`]);
    await listen<string>(name, (e) => {
      received.push(e.payload as string);
    });
  }
  await invoke("emit_multiple_events", { events });
  await new Promise((r) => setTimeout(r, 200));
  add("rust-events", `批量事件: 收到 ${received.length}/3 (${received.join(", ")})`);
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
  // 先停止已运行的服务器
  await invoke("disable_server");
  await new Promise((r) => setTimeout(r, 500));
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

async function testRestartServer() {
  await invoke("disable_server");
  await new Promise((r) => setTimeout(r, 500));
  await invoke("enable_server", { port: port.value });
  serverRunning.value = true;
  add("server", `服务器已重启 (端口 ${port.value})`);
}

async function testServerStatus() {
  const running = await invoke<boolean>("is_server_running");
  add("server", `服务器状态: ${running ? "运行中" : "已停止"}`);
}

async function testCustomPort() {
  const customPort = port.value + 1;
  await invoke("disable_server");
  await new Promise((r) => setTimeout(r, 500));
  await invoke("start_server_with_config", {
    port: customPort,
    enableLog: true,
    origin: "localhost",
  });
  serverRunning.value = true;
  add("server", `服务器已使用自定义端口 ${customPort} 启动`);
}

async function testRandomPort() {
  await invoke("disable_server");
  await new Promise((r) => setTimeout(r, 500));
  await invoke("start_server_with_config", {
    port: null,
    enableLog: true,
    origin: "localhost",
  });
  serverRunning.value = true;
  add("server", "服务器已使用随机端口启动");
}

// ── Test runner ───────────────────────────────────────
type TestFn = () => Promise<void>;

async function runTestFn(id: CatId, name: string, fn: TestFn) {
  try {
    await fn();
    results.value[id] ??= { passed: 0, failed: 0, total: 0 };
    results.value[id].passed++;
    results.value[id].total++;
  } catch (e) {
    add(id, `❌ ${name}: ${e}`);
    results.value[id] ??= { passed: 0, failed: 0, total: 0 };
    results.value[id].failed++;
    results.value[id].total++;
  }
}

async function runCategory(id: CatId) {
  add(id, `=== 开始 ${id} 测试 ===`);
  results.value[id] = { passed: 0, failed: 0, total: 0 };
  switch (id) {
    case "basic":
      await runTestFn(id, "echo_string", testEchoString);
      await runTestFn(id, "add_numbers", testAddNumbers);
      await runTestFn(id, "to_bool", testToBool);
      await runTestFn(id, "echo_json", testEchoJson);
      break;
    case "complex":
      await runTestFn(id, "get_user", testGetUser);
      await runTestFn(id, "get_paginated", testGetPaginated);
      break;
    case "error":
      await runTestFn(id, "always_fails", testAlwaysFails);
      await runTestFn(id, "divide(ok)", testDivideOk);
      await runTestFn(id, "divide(by zero)", testDivideByZero);
      break;
    case "events":
      await runTestFn(id, "emit_and_listen", testEmitAndListen);
      await runTestFn(id, "once", testOnce);
      await runTestFn(id, "listen_unlisten", testListenUnlisten);
      await runTestFn(id, "multiple_listeners", testMultipleListeners);
      await runTestFn(id, "string_payload", testStringPayload);
      await runTestFn(id, "number_payload", testNumberPayload);
      await runTestFn(id, "object_payload", testObjectPayload);
      await runTestFn(id, "array_payload", testArrayPayload);
      await runTestFn(id, "null_payload", testNullPayload);
      break;
    case "rust-events":
      await runTestFn(id, "emit_simple", testRustEmitSimple);
      await runTestFn(id, "emit_string", testRustEmitString);
      await runTestFn(id, "emit_number", testRustEmitNumber);
      await runTestFn(id, "emit_bool", testRustEmitBool);
      await runTestFn(id, "emit_object", testRustEmitObject);
      await runTestFn(id, "emit_array", testRustEmitArray);
      await runTestFn(id, "emit_nested", testRustEmitNested);
      await runTestFn(id, "emit_to_window", testRustEmitToWindow);
      await runTestFn(id, "emit_to_all", testRustEmitToAll);
      await runTestFn(id, "emit_from_window", testEmitFromWindow);
      await runTestFn(id, "emit_multiple", testRustEmitMultiple);
      break;
    case "app":
      await runTestFn(id, "app_info", testAppInfo);
      break;
    case "window":
      await runTestFn(id, "window_info", testWindowInfo);
      break;
    case "counter":
      await runTestFn(id, "increment", testIncrement);
      break;
    case "notes":
      await runTestFn(id, "write_notes", testWriteNotes);
      await runTestFn(id, "read_notes", testReadNotes);
      break;
    case "server":
      await runTestFn(id, "server_status", testServerStatus);
      await runTestFn(id, "start_server", testStartServer);
      await runTestFn(id, "restart_server", testRestartServer);
      await runTestFn(id, "custom_port", testCustomPort);
      await runTestFn(id, "random_port", testRandomPort);
      await runTestFn(id, "stop_server", testStopServer);
      break;
  }
  const r = results.value[id]!;
  add(id, `=== ${id} 测试完成: ✅ ${r.passed}/${r.total} 通过 ❌ ${r.failed} 失败 ===`);
}

async function runAll() {
  log.value = [];
  results.value = {};
  add("system", "========================================");
  add("system", "  开始运行所有测试");
  add("system", "========================================");
  const start = Date.now();
  for (const cat of categories) {
    await runCategory(cat.id as CatId);
  }
  const elapsed = Date.now() - start;
  const total = Object.values(results.value).reduce((s, r) => s + r.total, 0);
  const passed = Object.values(results.value).reduce((s, r) => s + r.passed, 0);
  const failed = Object.values(results.value).reduce((s, r) => s + r.failed, 0);
  add("system", "========================================");
  add("system", `  🎯 测试结论: ✅ ${passed}/${total} 通过 ❌ ${failed} 失败 ⏱ ${(elapsed / 1000).toFixed(1)}s`);
  add("system", "========================================");
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
      <div class="port-config">
        <label>端口:</label>
        <input type="number" v-model="port" min="1" max="65535" class="port-input" />
      </div>
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
            <template v-else-if="cat.id === 'events'">listen, once, trigger_event, 载荷类型测试</template>
            <template v-else-if="cat.id === 'rust-events'">Rust 端主动发射事件，多种载荷类型</template>
            <template v-else-if="cat.id === 'app'">getName, getVersion, getTauriVersion</template>
            <template v-else-if="cat.id === 'window'">title, size, position, theme 等</template>
            <template v-else-if="cat.id === 'counter'">通过 invoke 的原子计数器</template>
            <template v-else-if="cat.id === 'notes'">读写文件系统</template>
            <template v-else-if="cat.id === 'server'">启动/停止/重启，自定义端口，随机端口</template>
          </p>
          <p v-if="results[cat.id]" class="cat-result" :class="results[cat.id].failed > 0 ? 'result-fail' : 'result-pass'">
            ✅ {{ results[cat.id].passed }}/{{ results[cat.id].total }} 通过
            <template v-if="results[cat.id].failed > 0">❌ {{ results[cat.id].failed }} 失败</template>
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

.controls { margin-bottom: 16px; display: flex; gap: 8px; align-items: center; }
.btn { padding: 6px 14px; border: 1px solid #30363d; border-radius: 6px; background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 13px; }
.btn:hover { background: #30363d; }
.btn-primary { background: #238636; border-color: #2ea043; }
.btn-primary:hover { background: #2ea043; }
.btn-sm { padding: 3px 10px; font-size: 12px; }
.port-config { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.port-config label { font-size: 13px; color: #8b949e; }
.port-input { width: 80px; padding: 4px 8px; border: 1px solid #30363d; border-radius: 4px; background: #0d1117; color: #c9d1d9; font-size: 13px; }
.port-input:focus { outline: none; border-color: #1f6feb; }

.categories { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; margin-bottom: 20px; }
.cat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; }
.cat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.cat-desc { font-size: 12px; color: #8b949e; }
.cat-result { font-size: 11px; margin-top: 6px; padding-top: 6px; border-top: 1px solid #30363d; }
.result-pass { color: #2ea043; }
.result-fail { color: #da3633; }

.log-section h2 { font-size: 16px; margin-bottom: 8px; }
.log { background: #010409; border: 1px solid #30363d; border-radius: 8px; padding: 12px; min-height: 200px; max-height: 500px; overflow-y: auto; font-size: 13px; line-height: 1.6; font-family: "JetBrains Mono", "Fira Code", monospace; white-space: pre-wrap; word-break: break-all; }
</style>
