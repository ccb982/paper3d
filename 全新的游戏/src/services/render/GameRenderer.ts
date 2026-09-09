// ============================================================
// GameRenderer —— 战斗/主渲染器的全局持有者
// ============================================================
// ★ UI 复用战斗纹理绘制路径的唯一入口：背包/加工台的动态图标等
// 离屏烘焙（OffscreenBake）都必须用主渲染器（main.ts 创建的那个）
// 渲染，与战斗实体共用同一个 WebGL 上下文与风格管线——
// 绝不另开 WebGLRenderer（多上下文 = 状态孤岛 + 额外 GPU 开销）。
// ============================================================

import * as THREE from 'three';

let renderer: THREE.WebGLRenderer | null = null;

/** main.ts 创建主渲染器后注入（幂等；之后 UI 侧复用） */
export function setGameRenderer(r: THREE.WebGLRenderer | null): void {
  renderer = r;
}

/** 获取主渲染器（无人机图标等 UI 离屏烘焙用）；未注入时返回 null */
export function getGameRenderer(): THREE.WebGLRenderer | null {
  return renderer;
}