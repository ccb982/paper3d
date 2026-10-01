// ============================================================
// rapierWasm —— rapier wasm 手动实例化
// ============================================================
// ★ 关于 vite-plugin-wasm（2026-10-01 修正，原先的注释是错的）：
//   它是**必需**的，不能删。@dimforge/rapier3d/rapier_wasm3d.js 第 1 行就是裸的
//     import * as wasm from "./rapier_wasm3d_bg.wasm";
//   没有插件时 Vite 直接崩在 import-analysis（Failed to resolve import）。
//   但插件本身在 build 后不可靠（rollup 会把 glue 里的 __wbg_set_wasm 绑定整体
//   tree-shake → 运行时 `g.rawintegrationparameters_new is undefined`）。
//   所以正确姿势是**两层叠加**：插件负责"能被解析"，本文件负责"运行起来正确"。
//
// ★ 本机 npm 装不动（esbuild postinstall spawnSync EBUSY），node_modules 是指向
//   「全新的游戏」的目录 junction；版本完全一致（three 0.185.1 / rapier3d 0.14.0 /
//   vite-plugin-wasm 3.6.0 / vite-plugin-top-level-await 1.6.0）。

import wasmUrl from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm?url';
import * as bg from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

let ready: Promise<void> | null = null;

/** 进程内一次性实例化；main.ts 在任何 RAPIER.World 创建之前 await */
export function initRapierWasm(): Promise<void> {
  ready ??= (async () => {
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    const compiled = await WebAssembly.compile(bytes);
    const bgExports = bg as unknown as Record<string, (...a: unknown[]) => unknown>;
    const imports: WebAssembly.Imports = {};
    for (const imp of WebAssembly.Module.imports(compiled)) {
      const fn = bgExports[imp.name];
      if (typeof fn !== 'function') {
        throw new Error(`[rapier] wasm 导入函数缺失: ${imp.module}::${imp.name}`);
      }
      const slot = imports[imp.module] ?? (imports[imp.module] = {});
      slot[imp.name] = fn;
    }
    const instance = await WebAssembly.instantiate(compiled, imports);
    (bg as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
  })();
  return ready;
}
