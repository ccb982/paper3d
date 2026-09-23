// @dimforge/rapier3d 包内 glue 深导入的类型 shim（包本身未提供 bg.js 的 .d.ts）。
// 其余导出由 rapierWasm.ts 按 wasm 导入表动态匹配，无需逐个声明。
declare module '@dimforge/rapier3d/rapier_wasm3d_bg.js' {
  export function __wbg_set_wasm(val: unknown): void;
}
