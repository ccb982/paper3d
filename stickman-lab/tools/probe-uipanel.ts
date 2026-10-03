/**
 * 「模块归属」面板的**真渲染**测试 —— 用 jsdom 跑真实的 index.html + 真实的 hud.ts。
 *
 * ★ 为什么必须这么测：上一轮我只验证了 `TeacherSession.diag` 有数据，
 *   却漏了 `hud.setOwnership` 在 main.ts 里**根本没被调用** ⇒ 网页上一片空白。
 *   数据对≠ UI 会画。这次把 DOM 真的建出来、真的灌一次 diag，
 *   然后断言**面板里有内容**。
 *
 * 跑法：node tools/run.mjs probe-uipanel
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
  const compiled = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe-uipanel] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    (await WebAssembly.instantiate(compiled, imports)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { makeTeacherSession, CAPTURE_DEFAULT } = await import('../src/core/teacher');
const { DEFAULT_LAB, labHash } = await import('../src/core/lab');
const { Hud } = await import('../src/ui/hud');

const log = console.log;
let fails = 0;
const check = (n: string, ok: boolean, d = ''): void => { if (!ok) fails++; log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '   ' + d : ''}`); };

// ---- 真实 index.html（去掉 module script，jsdom 不跑 TS）----
const root = path.resolve(process.cwd());
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { pretendToBeVisual: true });
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { window: unknown }).window = dom.window;
const document = dom.window.document;

// canvas.getContext 在 jsdom 里返回 null ⇒ Hud 构造会抛。给它一个最小 stub。
(dom.window.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown })
  .getContext = () => ({
    canvas: null, clearRect() {}, setTransform() {}, save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, fillRect() {},
    fillText() {}, measureText: () => ({ width: 0 }), closePath() {},
  });

// ---- 真实 teacher 会话跑几拍，拿到真实 diag ----
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);   // ★ 12 关节；BRAIN_SHAPE 是 9 关节的默认值
const lab = DEFAULT_LAB;
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: lab.dur });
sim.begin(new Float32Array(sim.params.length));
const sess = makeTeacherSession(sk, sim, CAPTURE_DEFAULT, {
  dur: lab.dur, clockDriven: true, singleLeg: lab.singleLeg, liftHold: lab.liftHold,
});
// 全程统计：每个轴被驱动过几次、sys 与 owner 是否自洽
const driveCount = new Map<string, number>();
const sysOf = new Map<string, string>();
const ownerOf = new Map<string, string>();
let nanMos = 0, mosN = 0;
for (let i = 0; i < 1200 && !sim.finished; i++) {
  sess.step(1);
  if (i % 2) continue;
  const d = sess.diag;
  if (Number.isNaN(d.mosX)) nanMos++;
  if (Number.isFinite(d.mosX)) mosN++;
  for (const [k, sys] of d.sys) {
    driveCount.set(k, (driveCount.get(k) ?? 0) + 1);
    sysOf.set(k, sys);
    ownerOf.set(k, d.owner.get(k) ?? '');
  }
}

// ---- 真实 Hud，灌真实 diag ----
let received: unknown = null;
const hud = new Hud({
  onPause() {}, onResetPopulation() {}, onRespawn() {}, onExport() {}, onImport() {},
  onGhost() {}, onJoints() {}, onTextures() {}, onSigma() {}, onBudget() {}, onSpeed() {},
  onPhase() {}, onDriver() {}, onSingleLeg() {}, onDur() {}, onGaitTune() {},
});
hud.setOwnership(sess.diag);
received = sess.diag;

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const txt = (id: string): string => ($(id).textContent ?? '').trim();

log('「模块归属」面板 · 真渲染测试（jsdom + 真实 index.html + 真实 Hud）');
log(`  配置 ${labHash(lab)}`);
log('');
log('── 面板实际渲染出来的内容 ──');
log(`  左腿角色卡: ${txt('own-role-l').replace(/^左腿/, '')}`);
log(`  右腿角色卡: ${txt('own-role-r').replace(/^右腿/, '')}`);
log(`  相: ${txt('own-phase')}   接地: ${txt('own-ground')}   MoS: ${txt('own-mos')}`);
log(`  平衡门: ${txt('own-gate')}`);
const grid = $('own-grid');
const rows = grid.querySelectorAll('tr');
log(`  归属网格: ${rows.length} 行`);
for (const tr of Array.from(rows)) {
  const tds = Array.from(tr.querySelectorAll('td'));
  const cells = tds.slice(1).map((td) => {
    const sp = td.querySelector('span');
    return sp ? `${sp.className.replace('own-cell ', '').padEnd(9)}|${(sp.textContent ?? '').slice(0, 22).padEnd(22)}` : '';
  });
  log(`    ${(tds[0]?.textContent ?? '').trim().padEnd(16)} ${cells.join(' ')}`);
}
log('');
log('── 全程 1200 步的驱动统计（哪些轴真的被驱动过）──');
{
  const ever = [...driveCount.entries()].filter(([, n]) => n > 0).sort();
  log(`  被驱动过的轴：${ever.length} 个`);
  for (const [k, n] of ever) log(`    ${k.padEnd(12)} ${String(n).padStart(4)} 次   sys=${sysOf.get(k)}   owner=${ownerOf.get(k)}`);
  const never = [...Array.from({ length: 14 }, (_, i) => i)].flatMap(() => []);
  void never;
}
log('');
log(`── MoS 数值健康度 ──`);
log(`  有限 ${mosN} 帧 / NaN ${nanMos} 帧`);
if (nanMos > 0) {
  log('  ✗ MoS 出现 NaN ⇒ 平衡门在拿垃圾数字判定（NaN<=10 恒 false ⇒ 恒"挡住"）');
}
log('');
log('── 断言 ──');
check('面板元素都存在', ['own-role-l', 'own-role-r', 'own-phase', 'own-ground', 'own-mos',
  'own-gate', 'own-grid'].every((id) => !!document.getElementById(id)));
check('左腿卡有内容（不是 —）', txt('own-role-l').length > 3 && !/^左腿\s*—$/.test(txt('own-role-l')), txt('own-role-l'));
check('右腿卡有内容（不是 —）', txt('own-role-r').length > 3 && !/^右腿\s*—$/.test(txt('own-role-r')), txt('own-role-r'));
check('相/接地/MoS 都填上了', txt('own-phase') !== '—' && txt('own-ground') !== '—' && txt('own-mos') !== '—',
  `${txt('own-phase')} / ${txt('own-ground')} / ${txt('own-mos')}`);
check('平衡门有判定文本', txt('own-gate').length > 3, txt('own-gate'));
check('网格有 15 行（1 表头 + 14 部位）', rows.length === 15, `${rows.length}`);
const colored = Array.from(grid.querySelectorAll('span'))
  .filter((sp) => /sw-(hold|step|servo)/.test(sp.className));
check('网格里有彩色格（hold/step/servo）', colored.length >= 8, `${colored.length} 个`);
check('三种系统里至少出现 hold 与 step',
  colored.some((sp) => sp.className.includes('sw-hold')) && colored.some((sp) => sp.className.includes('sw-step')));

// 切回 null（ES 脑驱动）必须给出明确提示，而不是留一片空白
hud.setOwnership(null);
check('切到 ES 脑驱动时给出提示而不是空白',
  $('own-gate').dataset.ok === '1' && /不是 teacher/.test(txt('own-gate')), txt('own-gate'));

log('');
log(fails === 0 ? '★ 全绿：面板真的会画' : `✗ ${fails} 项失败`);
void received; void lab;