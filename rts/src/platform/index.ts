// ============================================================
// platform/index.ts —— 平台适配器注册表
// ============================================================
// 业务层（modes / services / ui）需要平台能力（音频、存储…）时，
// 一律走 getPlatformAdapter()，**不要**直接 new Audio / 碰 wx.*：
// 适配器实例由 main.ts 在 boot 阶段注入，换平台只换适配器实现。
//
// 未注入时返回 null（单测 / 独立验收页场景），调用方用可选链兜底，
// 不允许因为缺适配器而抛错中断流程。
// ============================================================

import type { PlatformAdapter } from './PlatformAdapter';

let current: PlatformAdapter | null = null;

/** 注入平台适配器（main.ts boot 时调用一次） */
export function setPlatformAdapter(adapter: PlatformAdapter): void {
  current = adapter;
}

/** 取当前平台适配器；未注入返回 null */
export function getPlatformAdapter(): PlatformAdapter | null {
  return current;
}
