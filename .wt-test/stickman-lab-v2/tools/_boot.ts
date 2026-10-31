/**
 * _boot.ts —— 探针共用的 rapier wasm 引导（必须在导入 sim/body 之前执行）
 *
 * 为什么需要：@dimforge/rapier3d 包内 `rapier_wasm3d.js` 第一行是裸的
 * `import * as wasm from "./rapier_wasm3d_bg.wasm"`，esbuild 里被 stub 成 `{}`。
 * 所以必须自己读取真实 .wasm、按导入表 instantiate、再 `__wbg_set_wasm` 覆盖。
 *
 * ★ 顺序硬约束：**先**把这个模块 import 完（它会完成覆盖），**再** import 用到
 *   rapier 的业务模块。反过来会被占位对象盖掉。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const bg = bgNs as any;
const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
const compiled = await WebAssembly.compile(fs.readFileSync(p));
const im: any = {};
for (const i of WebAssembly.Module.imports(compiled)) {
  const impl = (bg as any)[i.name];
  if (typeof impl === 'function') (im[i.module] ??= {})[i.name] = impl;
}
bg.__wbg_set_wasm((await WebAssembly.instantiate(compiled, im)).exports);

export {};
