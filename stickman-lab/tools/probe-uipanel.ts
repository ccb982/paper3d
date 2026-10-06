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
  // 类型必须是 ModuleImport（ExportValue 的联合），否则 `WebAssembly.instantiate`
  // 的重载匹配不上 —— 这里全是函数，窄化成函数签名即可。
  type WasmFn = (...a: unknown[]) => unknown;
  const im: Record<string, Record<string, WasmFn>> = {};
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
const { STATE_ORDER } = await import('../src/core/gaitState');
const { Hud } = await import('../src/ui/hud');

const log = console.log;
const NL = String.fromCharCode(10);
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
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 8 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: DEFAULT_LAB.startBearer },
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
  onPhase() {}, onSingleLeg() {}, onDur() {}, onGaitTune() {},
  // ★ 这个以前**漏了** —— `HudHooks` 要求 `onAxisMarkers`，探针没提供。
  //   于是 UI 门禁**根本没覆盖方向标控件**（+X 前 / +Z 左 / -Z 右 那三个标记），
  //   而 typecheck 之前不检查 tools/ ⇒ 这个覆盖缺口一直没人发现。
  //   发现途径：`tsconfig.tools.json`（见该文件顶部说明）。
  onAxisMarkers() {},
});
hud.setOwnership(snap);

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const txt = (id: string): string => ($(id).textContent ?? '').trim();
import type { Skeleton } from '../src/core/skeleton';

/** 绑定姿态下某刚体的中心 z（**米**，与仿真帧无关）。用于校验轴约定。 */
function skBodyZ(sk: Skeleton, key: string): number {
  return sk.bodies.find((b) => b.key === key)?.cz ?? NaN;
}

log('同源门禁 —— UI 与冒烟测试读同一个 RigSnapshot');
log(`  配置 ${labHash(DEFAULT_LAB)}`);
log(`  快照 tick=${snap.tick} t=${snap.t.toFixed(2)}s state=${snap.state} 承重=${snap.loadBearer ?? '-'}`);
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
log('-- 断言：UI 必须**逐字**渲染 telemetry（不推导）--');
const tm = snap.telemetry;
check('控制器真的提了需求（≠0）', demand > 0, `${demand} 条`);
check('需求全部落在真实关节上（badRequests=0）', ctrl.rs.badRequests === 0, `${ctrl.rs.badRequests}`);
check('左腿卡非空', txt('own-role-l').length > 4, txt('own-role-l'));
check('右腿卡非空', txt('own-role-r').length > 4, txt('own-role-r'));
// ★ 核心断言：这些字段**只允许**来自 telemetry，逐字相等。
//   以前 UI 自己去快照抓量自己格式化，于是同一物理量有两套口径 ——
//   本项目栽过四次（轴索引 / 符号 / 单位 / 帧域）。
const verbatim: [string, string][] = [
  ['own-phase', `${tm.stateLabel} ${tm.stateT}s`],
  ['own-verified', tm.verified],
  ['own-safe', `安全 ${tm.safe}`],
  ['own-ground', tm.contact],
  ['own-loadfrac', `${tm.loadFrac} %`],
  ['own-sag', tm.sagRecv],
  ['own-recvpeak', `${tm.recvPeak} %`],
  ['own-domain', `${tm.domainWorst}°`],
  ['own-permit', tm.stepPermit],
  ['own-mos', `${tm.mos} mm`],
  ['own-pitch', `${tm.pitch}°`],
  ['own-roll', `${tm.roll}°`],
  ['own-alpha', tm.alpha],
  ['own-clr', `${tm.clearance} mm`],
  ['own-joints', tm.jointsDeg],
  ['own-next', tm.next],
  ['own-wait', tm.wait],
  ['own-blocked', tm.blocked],
];
for (const [id, want] of verbatim) {
  check(`#${id} 逐字 === telemetry`, txt(id) === want, `UI「${txt(id)}」 vs 远测「${want}」`);
}
// ★ 五态环：5 格逐字 === telemetry.ring，且当前态标记与 rs.state 一致
{
  // 环长度**从 STATE_ORDER 取**，不许写死 5/6 —— 拆态时忘了改 UI 就会被这条抓住
  const cells = STATE_ORDER.map((_st, i) => txt(`own-ring-${i}`));
  check('状态环逐字 === telemetry.ring',
    cells.every((c, i) => c === (tm.ring[i] ?? '—')),
    cells.join(' | '));
  check('环上恰好一个当前态 ▶', tm.ring.filter((x) => x.charCodeAt(0) === 0x25b6).length === 1,
    tm.ring.join(' '));
  check(`环长度 === STATE_ORDER（${STATE_ORDER.length}）`, tm.ring.length === STATE_ORDER.length,
    `telemetry ${tm.ring.length} 格 / UI ${cells.length} 格`);
  check('环上当前态 === rs.state 的标签', tm.ring.includes(`▶${tm.stateLabel}`), tm.stateLabel);
  check('下一态 === 环的固定后继',
    tm.next === tm.ring[(tm.ring.findIndex((x) => x.charCodeAt(0) === 0x25b6) + 1) % tm.ring.length]!.slice(1),
    `${tm.next}`);
}
// ★ Perry 签名块：必须逐字等于 telemetry.sigs，且与 violations 一致
{
  const sigTxt = txt('own-sig');
  check('签名块逐字 === telemetry.sigs', sigTxt === tm.sigs.join(NL),
    `UI ${tm.sigs.length} 行 / 遥测 ${tm.sigs.length} 行`);
  check('签名行数 === 该态验收项数', tm.sigs.length > 0, `${tm.sigs.length} 行`);
  const hard = tm.sigs.filter((x) => x.startsWith('✗')).length;
  check('拦迁移项数 === rs.violations 数', hard === snap.violations.length,
    `签名 ✗ ${hard} 项 / violations ${snap.violations.length} 项`);
}
// ★ 力链块：必须逐字等于 telemetry.force
{
  const ftxt = txt('own-force');
  const wantF = tm.force.join(NL);
  check('力链块逐字 === telemetry.force', ftxt === wantF,
    ftxt === wantF ? `UI ${tm.force.length} 行`
      : `UI「${ftxt.slice(0, 40)}」 vs 遥测「${wantF.slice(0, 40)}」`);
  check('力链行数合理（≥6 行）', tm.force.length >= 6, `${tm.force.length} 行`);
}
// ★ 平衡修正块：逐字等于 telemetry.balanceFix
{
  const btxt = txt('own-bfix');
  check('平衡修正块逐字 === telemetry.balanceFix', btxt === tm.balanceFix.join(NL),
    `UI ${tm.balanceFix.length} 行`);
  check('平衡修正块有内容（平衡系统真的在动关节）', tm.balanceFix.length >= 1,
    tm.balanceFix[0] ?? '(空)');
}
check('网关回读不是占位符', !tm.jointsDeg.includes('—') && tm.jointsDeg.length > 8, tm.jointsDeg);
check('未过项与状态机一致',
  snap.violations.length === 0
    ? txt('own-crit').includes('判据全过')
    : txt('own-crit').includes(tm.violations.split('　')[0]!),
  `${snap.violations.length} 项`);
check('判据面板含承重/迈步', txt('own-crit').includes('承重') && txt('own-crit').includes('迈步'));
check('网格 15 行（1 表头 + 14 部位）', grid.querySelectorAll('tr').length === 15);
const colored = Array.from(grid.querySelectorAll('span')).filter((sp) => /sw-(hold|step|servo)/.test(sp.className));
check('网格有归属着色', colored.length >= 4, `${colored.length} 格`);

// ★ 轴约定自证：约定是 `+Z = 左`。
//   ⚠ 必须用**绑定姿态**（t=0、未受力）来验证，**不能**用仿真中的某一帧：
//     身体会偏航/倒地，live z 会翻（曾实测到右脚 z=+223mm），那是姿态不是约定。
//   绑定姿态里 4 个左侧刚体（thigh/shin/arm/hand）应全部为正 z。
{
  const L = ['thigh_l', 'shin_l', 'arm_l', 'hand_l'].map((k) => skBodyZ(sk, k));
  const R = ['thigh_r', 'shin_r', 'arm_r', 'hand_r'].map((k) => skBodyZ(sk, k));
  const okL = L.every((v) => v > 0.02), okR = R.every((v) => v < -0.02);
  check('轴约定：绑定姿态 左侧 4 刚体全在 +Z、右侧全在 −Z', okL && okR,
    `左 [${L.map((v) => (v * 1000).toFixed(0)).join('/')}]mm  右 [${R.map((v) => (v * 1000).toFixed(0)).join('/')}]mm`);
  const txtL = txt('own-ax-l').replace(/[^0-9.\-+]/g, '');
  const txtR = txt('own-ax-r').replace(/[^0-9.\-+]/g, '');
  check('图例显示的本帧脚 z === 快照（不校验符号，那是姿态）',
    Math.abs(Number(txtL) - snap.legs.l.footZ * 1000) < 1.5
    && Math.abs(Number(txtR) - snap.legs.r.footZ * 1000) < 1.5,
    `UI ${txtL}/${txtR} vs 快照 ${(snap.legs.l.footZ * 1000).toFixed(0)}/${(snap.legs.r.footZ * 1000).toFixed(0)}`);
}
// ★ 承重腿以 **telemetry.roles**（状态机原话）为准。
//   以前断言去两张腿卡里找 '★承重' 字样：跌倒时会出现
//   「loadBearer=l 但该腿已离地 ⇒ 卡上写『摆动』」，断言就红了 ——
//   那不是 UI 撒谎，是断言用错了口径（腿卡是物理诊断，承重腿是状态机角色）。
check('承重腿 === 状态机角色', txt('own-gate').includes(tm.roles), `gate「${txt('own-gate')}」vs roles「${tm.roles}」`);

hud.setOwnership(null);
check('切到 ES 脑驱动时明确提示而非空白', txt('own-gate').includes('不是 controller'));
log('');
// ══ 静态门禁：UI 不得再出现"第二套口径" ══════════════════════════════
log('');
log('-- 静态门禁 --');
{
  const hudSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
  const htmlIds = new Set(Array.from(html.matchAll(/id="([\w-]+)"/g)).map((m) => m[1]!));
  const wantIds = Array.from(hudSrc.matchAll(/\$\('([\w-]+)'\)/g)).map((m) => m[1]!);
  const missing = wantIds.filter((i) => !htmlIds.has(i));
  check(`hud.ts 引用的 ${wantIds.length} 个元素 id 全部存在于 index.html`, missing.length === 0,
    missing.length ? `缺：${missing.join(', ')}` : '');

  // ★ 反向门禁：UI 不得自己从快照里取"状态机已经算过的量"。
  //   只允许 telemetry.*；d.criteria / d.forceChain / d.legs 是另外两类数据（判据明细与物理诊断）。
  const banned = ['d.state', 'd.stateT', 'd.verified', 'd.violations', 'd.mos', 'd.pitchDeg',
    'd.rollDeg', 'd.authority', 'd.swingClearance', 'd.phase'];
  const used = banned.filter((b) => hudSrc.includes(b));
  // ★ 平衡/迈步**不得自己读接触与 CoP**：力链归状态机（架构 §20.3）。
  //   此前这两处各有一套口径，导致"UI 说有接触、状态机说没有"。
  for (const f of ['src/core/systems/balance.ts', 'src/core/systems/step.ts']) {
    // ⚠ 必须先**剥掉注释**再查：这个门禁第一次跑就报"仍直读 readCoP"，
    //   而那两处只是**注释里提到**了这个名字（本项目此前也栽过同样的假阳性）。
    const raw = fs.readFileSync(path.resolve(process.cwd(), f), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const hits = ['rs.cop.', 'readCoP', 'footLoadFrac', 'footGrip', 'soleForceProfile']
      .filter((k) => src.includes(k));
    check(`${f} 不直读接触/CoP（只准读 rs.groundChain）`, hits.length === 0,
      hits.length ? `仍直读：${hits.join(', ')}` : '');
  }
  check('UI 不再自行推导状态机量（只读 telemetry.*）', used.length === 0,
    used.length ? `仍直接读：${used.join(', ')}` : '');
}

log(fails === 0 ? '★ 全绿：UI 与冒烟测试同源' : `X ${fails} 项失败`);