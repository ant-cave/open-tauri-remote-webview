// MIT License
// Copyright (c) 2026 ant-cave <antmmmmm@126.com> (https://github.com/ant-cave)
// See LICENSE file in the root directory.

import * as logger from "./logger.js";

const MODULE = "environment";
logger.info(MODULE, "=== environment state module loading ===");

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
  logger.info(MODULE, `setting environment state: isNativeTauri=${value}`);
  _isNativeTauri = value;
  _isDetected = true;
}

/**
 * 获取环境检测结果
 * 如果尚未检测，返回 false
 */
export function isNativeTauri(): boolean {
  if (!_isDetected) {
    logger.warn(MODULE, "environment detection not yet completed, returning default false");
  }
  logger.debug(MODULE, `isNativeTauri() returns: ${_isNativeTauri}`);
  return _isNativeTauri;
}

/**
 * 检查环境检测是否已完成
 */
export function isDetected(): boolean {
  logger.debug(MODULE, `isDetected() returns: ${_isDetected}`);
  return _isDetected;
}

logger.info(MODULE, "=== environment state module loading complete ===");
