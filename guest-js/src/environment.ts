// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import * as logger from "./logger.js";

const MODULE = "environment";
logger.info(MODULE, "=== 环境状态模块开始加载 ===");

/**
 * 共享的环境状态模块
 * 存储统一的环境检测结果，供所有模块使用
 */

let _isNativeTauri = false;
let _isDetected = false;

/**
 * 设置环境检测结果（由 bridge-init.ts 调用）
 */
export function setNativeTauri(value: boolean): void {
  logger.info(MODULE, `设置环境状态: isNativeTauri=${value}`);
  _isNativeTauri = value;
  _isDetected = true;
}

/**
 * 获取环境检测结果
 * 如果尚未检测，返回 false
 */
export function isNativeTauri(): boolean {
  if (!_isDetected) {
    logger.warn(MODULE, "环境检测尚未完成，返回默认值 false");
  }
  logger.debug(MODULE, `isNativeTauri() 返回: ${_isNativeTauri}`);
  return _isNativeTauri;
}

/**
 * 检查环境检测是否已完成
 */
export function isDetected(): boolean {
  logger.debug(MODULE, `isDetected() 返回: ${_isDetected}`);
  return _isDetected;
}

logger.info(MODULE, "=== 环境状态模块加载完成 ===");
