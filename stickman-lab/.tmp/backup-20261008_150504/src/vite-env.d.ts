/// <reference types="vite/client" />

// rapier 包内的 wasm glue 没有独立 .d.ts，按导入表动态映射其导出（见 core/rapierWasm.ts）
declare module '@dimforge/rapier3d/rapier_wasm3d_bg.js';
