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

/**
 * ★ 着色器错误校验开关（three.js `renderer.debug.checkShaderErrors`）
 *
 * three 默认 **true**：每个 program 链接完成后都会同步调用
 * `getProgramInfoLog` / `getShaderInfoLog` 回读驱动日志。这两个调用会
 * 强制 GPU 同步 + 驱动往返，把着色器首次编译从"异步流畅"变成
 * "主线程阻塞"。实测 CPU 采样里 `getProgramInfoLog` 占比高达 ~66%，
 * 是"进入世界 / 首次打开抽卡页"这类长任务的主因。
 *
 * 因此默认关闭；需要排查 GLSL 编译错误时用 `?shadercheck=1` 打开。
 * 注意：该开关**不是** WebGLRendererParameters 的字段，只能构造后赋值，
 * 所以所有渲染器构造点都必须跟上一次 applyShaderDebug()。
 */
export function shaderDebugEnabled(): boolean {
  return new URLSearchParams(location.search).get('shadercheck') === '1';
}

/** 把着色器调试开关应用到渲染器（构造之后立刻调用） */
export function applyShaderDebug(r: THREE.WebGLRenderer): void {
  r.debug.checkShaderErrors = shaderDebugEnabled();
}