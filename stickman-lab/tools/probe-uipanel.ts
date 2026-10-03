/**
 * ★★ **同源门禁**：UI 与冒烟测试读的是**同一个 `RigSnapshot` 对象**。
 *
 *   这是"你看到的和我回读的必须一致"的机械保证：
 *   本探针把快照灌进**真实的 `Hud`**，然后断言
 *   **UI 能画出来的每个字段都非空**，且画出来的值 === 快照里的值。
 *
 *   ★ 修这个之前做不到：`hud.setOwnership` 在 main.ts 里**根本没被调用**，
 *     网页上一片空白，而所有离屏探针都"正常" —— 数据对 ≠ UI 会画。
 *
 * 跑法：npm run uipanel
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as Record<string, (...a: unknown[]) => unknown>;
  const im: Record<string, Record<string, unknown>> = {};
  for (const i2 of WebAssembly.Module.imports(c)) {
    const f = bg[i2.name];
    if (typeof f !== 'function') throw new Error(i2.name);
    (im[i2.module] ??= {})[i2.name] = f;
  }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { DEFAULT_LAB, labHash } = await import('../src/core/lab');
const { Hud } = await import('../src/ui/hud');

const log = console.log;
let fails = 0;
const check = (n: string, ok: boolean, d = ''): void => { if (!ok) fails++; log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '   ' + d : ''}`); };

const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { pretendToBeVisual: true });
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { window: unknown }).window = dom.window;
const document = dom.window.document;
(dom.window.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
  canvas: null, clearRect() {}, setTransform() {}, save() {}, restore() {}, beginPath() {},
  moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillRect() {}, fillText() {},
  measureText: () => ({ width: 0 }), closePath() {},
});

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 8, driver: 'controller' });
sim.begin(new Float32Array(sim.params.length));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, singleLeg: DEFAULT_LAB.singleLeg, liftHold: DEFAULT_LAB.liftHold },
});
const dtC = 1 / sim.cfg.controlHz, dtP = 1 / sim.cfg.physicsHz;
const stages = Math.max(1, Math.round(dtP / dtC));
let demand = 0;
for (let i = 0; i < Math.round(3 / dtP); i++) {
  if (i % stages === 0) { sim.doll.setMotorTargets(ctrl.step(dtC)); demand = ctrl.rs.requestCount; }
  sim.advance(1);
}
const snap = ctrl.snapshot;

const hud = new Hud({
  onPause() {}, onResetPopulation() {}, onRespawn() {}, onExport() {}, onImport() {},
  onGhost() {}, onJoints() {}, onTextures() {}, onSigma() {}, onBudget() {}, onSpeed() {},
  onPhase() {}, onDriver() {}, onSingleLeg() {}, onDur() {}, onGaitTune() {},
});
hud.setOwnership(snap);

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const txt = (id: string): string => ($(id).textContent ?? '').trim();
import { PHASE_LABEL as PH } from '../src/ui/hud';   // ★ 与 HUD 同一份，不再复制

log('同源门禁 —— UI 与冒烟测试读同一个 RigSnapshot');
log(`  配置 ${labHash(DEFAULT_LAB)}`);
log(`  快照 tick=${snap.tick} t=${snap.t.toFixed(2)}s phase=${snap.phase} 承重=${snap.loadBearer ?? '-'}`);
log(`  控制器本拍提需求数 = ${demand}（0 ⇒ 控制器没在控制）`);
log('');
log('-- UI 实际渲染 --');
log(`  左腿 ${txt('own-role-l').replace(/^左腿/, '')}`);
log(`  右腿 ${txt('own-role-r').replace(/^右腿/, '')}`);
log(`  相 ${txt('own-phase')} | 接地 ${txt('own-ground')} | MoS ${txt('own-mos')} | alpha ${txt('own-alpha')}`);
log('  判据面板:');
for (const line of txt('own-crit').split('\n')) log(`    ${line}`);
const grid = $('own-grid');
log(`  网格 ${grid.querySelectorAll('tr').length} 行`);
for (const tr of Array.from(grid.querySelectorAll('tr')).slice(0, 6)) {
  const tds = Array.from(tr.querySelectorAll('td'));
  log(`    ${(tds[0]?.textContent ?? '').padEnd(10)} `
    + tds.slice(1, 4).map((td) => (td.querySelector('span')?.textContent ?? '').padEnd(14)).join('')
    + ` ${tds[4]?.textContent ?? ''}`);
}
log('');
log('-- 断言 --');
check('控制器真的提了需求（≠0）', demand > 0, `${demand} 条`);
check('需求全部落在真实关节上（badRequests=0）', ctrl.rs.badRequests === 0, `${ctrl.rs.badRequests}`);
check('左腿卡非空', txt('own-role-l').length > 4, txt('own-role-l'));
check('右腿卡非空', txt('own-role-r').length > 4, txt('own-role-r'));
check('相位/接地/MoS/alpha 都非空',
  txt('own-phase') !== '—' && txt('own-ground') !== '—' && txt('own-mos') !== '—' && txt('own-alpha') !== '—');
check('判据面板含承重/迈步', txt('own-crit').includes('承重') && txt('own-crit').includes('迈步'));
check('网格 15 行（1 表头 + 14 部位）', grid.querySelectorAll('tr').length === 15);
const colored = Array.from(grid.querySelectorAll('span')).filter((sp) => /sw-(hold|step|servo)/.test(sp.className));
check('网格有归属着色', colored.length >= 4, `${colored.length} 格`);

const uiMos = Number(txt('own-mos').replace(/[^0-9.\-]/g, ''));
check('UI 的 MoS === 快照.mos', Math.abs(uiMos - snap.mos * 1000) < 1.5,
  `UI ${uiMos} vs 快照 ${(snap.mos * 1000).toFixed(0)}`);
check('UI 的相 === 快照.phase', txt('own-phase').startsWith(PH[snap.phase] ?? '?'));
check('UI 的 alpha === 快照.authority', Math.abs(Number(txt('own-alpha')) - snap.authority) < 0.01);
check('承重腿卡与快照一致',
  snap.loadBearer === null || (txt('own-role-l') + txt('own-role-r')).includes('★承重'));

hud.setOwnership(null);
check('切到 ES 脑驱动时明确提示而非空白', txt('own-gate').includes('不是 controller'));
log('');
log(fails === 0 ? '★ 全绿：UI 与冒烟测试同源' : `X ${fails} 项失败`);