// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

/**
 * 统一日志工具模块
 * 提供结构化、可追踪的日志输出功能
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

// 日志级别优先级
const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// 当前日志级别（可通过 setLogLevel 调整）
let currentLevel: LogLevel = "DEBUG";

// 是否启用日志
let enabled = true;

/**
 * 设置日志级别
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
  console.log(`[Logger] 日志级别已设置为: ${level}`);
}

/**
 * 启用/禁用日志
 */
export function setLogEnabled(value: boolean): void {
  enabled = value;
  console.log(`[Logger] 日志已${value ? "启用" : "禁用"}`);
}

/**
 * 格式化时间戳
 */
function formatTimestamp(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
  return `[${dateStr}][${timeStr}]`;
}

/**
 * 检查是否应该输出该级别的日志
 */
function shouldLog(level: LogLevel): boolean {
  if (!enabled) return false;
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

/**
 * 输出日志
 */
export function log(level: LogLevel, module: string, message: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return;

  const timestamp = formatTimestamp();
  const prefix = `${timestamp}[${module}][${level}]`;

  switch (level) {
    case "DEBUG":
      console.debug(prefix, message, ...args);
      break;
    case "INFO":
      console.info(prefix, message, ...args);
      break;
    case "WARN":
      console.warn(prefix, message, ...args);
      break;
    case "ERROR":
      console.error(prefix, message, ...args);
      break;
  }
}

/**
 * 快捷方法
 */
export const debug = (module: string, message: string, ...args: unknown[]) =>
  log("DEBUG", module, message, ...args);

export const info = (module: string, message: string, ...args: unknown[]) =>
  log("INFO", module, message, ...args);

export const warn = (module: string, message: string, ...args: unknown[]) =>
  log("WARN", module, message, ...args);

export const error = (module: string, message: string, ...args: unknown[]) =>
  log("ERROR", module, message, ...args);

/**
 * 记录函数调用
 */
export function traceCall(module: string, fnName: string, params?: Record<string, unknown>): void {
  const paramStr = params ? ` ${JSON.stringify(params)}` : "";
  debug(module, `>>> ${fnName}()${paramStr}`);
}

/**
 * 记录函数返回
 */
export function traceReturn(module: string, fnName: string, result?: unknown): void {
  const resultStr = result !== undefined ? ` => ${JSON.stringify(result)}` : "";
  debug(module, `<<< ${fnName}()${resultStr}`);
}

/**
 * 记录错误
 */
export function traceError(module: string, fnName: string, err: unknown): void {
  error(module, `!!! ${fnName}() 失败:`, err);
}
