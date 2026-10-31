/// <reference types="vite/client" />

// ★ rapier 包内裸 .wasm 导入 + ?url 查询串（v1 同款声明）
declare module '@dimforge/rapier3d/rapier_wasm3d_bg.wasm?url' {
  const url: string;
  export default url;
}
declare module '@dimforge/rapier3d/rapier_wasm3d_bg.js' {
  export function __wbg_set_wasm(w: unknown): void;
  export * from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm';
}
