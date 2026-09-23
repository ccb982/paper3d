// ============================================================
// rapierWasm —— rapier wasm 手动实例化（绕开打包器插件链的不可靠转译）
// ============================================================
// ★ 背景（2026-08-28，两度踩坑后定稿根治）：
//   vite-plugin-wasm 对 node_modules 内 .wasm ESM 导入不转译
//   （dev 可用、build 静默失效），rollup 随后把 glue 的 __wbg_set_wasm
//   绑定调用整体 tree-shake → 运行时 `g.rawintegrationparameters_new`
   //  undefined（2026-08-23 同款坑，当时退回 compat；今日换思路根治）。
//   根治：自己 fetch ?url 资产 → 按导入表（22 个，模块名 './rapier_wasm3d_bg.js'）
//   映射 bg.js 同名导出 → WebAssembly.instantiate → __wbg_set_wasm 注入。
//   全程零插件依赖，dev/build 行为一致。
// ============================================================

import wasmUrl from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm?url';
// @ts-ignore — 包内 glue 无独立 .d.ts（见 rapier-bg.d.ts shim）；按导入表动态匹配其导出
import * as bg from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

let ready: Promise<void> | null = null;

/** 进程内一次性实例化；ensureRapierReady 消费（main.ts 进入战斗前 await） */
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
