/**
 * tools/ 的环境垫片（只在 `tsconfig.tools.json` 下生效）。
 *
 * 目的：让 `npm run typecheck:tools` 能真正抓 bug（重复声明、模块不存在、
 * 参数不匹配、未定义变量），而不被下面这些**环境噪音**淹没。
 *
 * ⚠ 与 `tsconfig.json`（src 用的 strict 配置）**故意不同**：
 *   src 不 import 这些包，所以不需要。
 */

// ── jsdom：`probe-uipanel` 在 node 里模拟 DOM，但它没有类型声明 ──
//   `window` 声明成 `any`：探针要访问 `window.document`、
//   `window.HTMLCanvasElement`（用来伪造 canvas），这些是 jsdom 的运行时成员，
//   没有任何 .d.ts 能描述。只声明成 `unknown` 会让探针写不下去 ⇒ 只能 `any`。
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, opts?: Record<string, unknown>);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window: any;
  }
}

// ── `@dimforge/rapier3d`：WASM 绑定，仓库里没有 .d.ts ──
//   探针只在**初始化**阶段用它（顶层 await 注入 wasm），之后一律走
//   `src/core/ragdoll.ts` 自己的类型化封装，所以这里 `any` 足够。
declare module '@dimforge/rapier3d/rapier_wasm3d_bg.js' {
  const bg: Record<string, unknown> & { __wbg_set_wasm?: (x: unknown) => void };
  export = bg;
}