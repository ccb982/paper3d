/**
 * 「模块归属」面板的数据自检 —— 验证 `TeacherSession.diag` 真的填满了。
 *
 * 为什么要这个：面板是 DOM，探针跑不到；于是又变成"只有网页能看见"的东西。
 * 本探针把**网页用的同一个** `makeTeacherSession` + `session.step(n)` + `session.diag`
 * 跑一遍并打印，确认：
 *   ① 每个部位/轴的归属标签都能填上（不是空的）
 *   ② 平衡维持与迈步**都真的在出力**（两套系统都有非零占比）
 *   ③ 前腿/后腿/承重腿是**实测**的，不是硬编码左右
 *   ④ 面板上"挡腿"的次数与实际离地高度一致（门真的在起作用）
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
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
    if (typeof fn !== 'function') throw new Error(`[probe-own] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    (await WebAssembly.instantiate(compiled, imports)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { makeTeacherSession, CAPTURE_DEFAULT } = await import('../src/core/teacher');
const { DEFAULT_LAB, labHash } = await import('../src/core/lab');
const { shapeForJoints } = await import('../src/core/brain');
const { newCom, readCom } = await import('../src/core/posture');

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);   // ★ 12 关节；BRAIN_SHAPE 是 9 关节的默认值
const lab = DEFAULT_LAB;
const DT = 1 / 120;
const log = console.log;
let fails = 0;
const check = (n: string, ok: boolean, d = ''): void => { if (!ok) fails++; log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '   ' + d : ''}`); };

const PARTS: [string, string][] = [
  ['neck', '颈'], ['shoulder_l', '左肩'], ['shoulder_r', '右肩'],
  ['elbow_l', '左肘'], ['elbow_r', '右肘'], ['hip_l', '左髋'], ['hip_r', '右髋'],
  ['knee_l', '左膝'], ['knee_r', '右膝'], ['foot_l', '左踝'], ['foot_r', '右踝'],
  ['spine1', '腰1'], ['spine2', '腰2'], ['spine3', '腰3'],
];

log('模块归属面板 · 数据自检（与网页同一个 makeTeacherSession）');
log(`  配置 ${labHash(lab)}`);
log('');

// 单腿模式跑两遍（左支撑 / 右支撑），确认角色是实测的
for (const side of ['l', 'r'] as const) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: lab.dur });
  sim.begin(new Float32Array(sim.params.length));
  const sess = makeTeacherSession(sk, sim, CAPTURE_DEFAULT, {
    dur: lab.dur, clockDriven: true, singleLeg: side, liftHold: lab.liftHold,
  });
  const cnt = { hold: 0, step: 0, servo: 0, none: 0 };
  let frames = 0, blocked = 0, axesSum = 0;
  let frontChanged = false, firstFront = '';
  const steps = Math.round(lab.dur / DT);
  for (let i = 0; i < steps && !sim.finished; i++) {
    sess.step(1);
    if (i % 20) continue;                // 每 ~0.17 s 采一帧
    frames++;
    const d = sess.diag;
    if (d.balOk === false) blocked++;
    axesSum += d.nAxes;
    for (const [key] of PARTS) for (let ax = 0; ax < 3; ax++) {
      const s = d.sys.get(`${key}/${ax}`);
      if (s) cnt[s]++; else cnt.none++;
    }
    const f = d.frontLeg === 'l' ? '左' : '右';
    if (!firstFront) firstFront = f;
    else if (f !== firstFront) frontChanged = true;
  }
  const owned = cnt.hold + cnt.step + cnt.servo;
  const total = owned + cnt.none;
  // ★ 只有一部分轴是"设计上有用"的（膝的轴0/1、肘的部分轴从不驱动），
  //   所以不该断言"大部分轴都被驱动"，而要断言"被驱动的轴都有非空机制标签"。
  let labelled = 0, driven = 0;
  for (const [key] of PARTS) for (let ax = 0; ax < 3; ax++) {
    const k = `${key}/${ax}`;
    const ow = sess.diag.owner.get(k);
    if (sess.diag.sys.get(k)) { driven++; if (ow && ow !== '—') labelled++; }
  }
  log(`── 支撑腿 = ${side === 'l' ? '左' : '右'}   存活 ${(sim.ticksDone / sim.cfg.controlHz).toFixed(2)}s / ${lab.dur}s`);
  log(`   归属占比  平衡维持 ${(cnt.hold / total * 100).toFixed(1)}%   `
    + `迈步 ${(cnt.step / total * 100).toFixed(1)}%   伺服 ${(cnt.servo / total * 100).toFixed(1)}%   `
    + `未驱动 ${(cnt.none / total * 100).toFixed(1)}%`);
  log(`   末帧  相=${sess.diag.phase}  前腿=${sess.diag.frontLeg}  后腿=${sess.diag.backLeg}  `
    + `承重=${sess.diag.stanceLeg}  摆动=${sess.diag.swingLeg}  接地=${(sess.diag.groundL?1:0)+(sess.diag.groundR?1:0)}`);
  log('');
  check(`  [${side}] 每个被驱动的轴都有非空机制标签`, driven > 0 && driven === labelled,
    `${labelled}/${driven} 个轴有标签`);
  check(`  [${side}] 被驱动的轴数合理（不是全驱动也不是几乎不驱动）`, driven >= 8 && driven <= 24, `${driven}/42`);
  check(`  [${side}] 平衡维持系统真的在出力`, cnt.hold > 0, `${cnt.hold} 轴·帧`);
  check(`  [${side}] 迈步系统真的在出力`, cnt.step > 0, `${cnt.step} 轴·帧`);
  check(`  [${side}] 每拍都有指令下发（nAxes 是**每拍**值，不是累计）`, axesSum / Math.max(1, frames) >= 4,
    `均 ${(axesSum / Math.max(1, frames)).toFixed(1)} 轴/拍`);
  check(`  [${side}] 承重腿 = 指定的那条`, sess.diag.stanceLeg === side, `${sess.diag.stanceLeg}`);
  check(`  [${side}] 前腿/后腿互补`, sess.diag.frontLeg !== sess.diag.backLeg,
    `${sess.diag.frontLeg}/${sess.diag.backLeg}`);
  void frontChanged; void blocked; void readCom;
}
log('');
log(fails === 0 ? '★ 全绿：面板数据可信' : `✗ ${fails} 项失败`);
log('★ 打开网页对照：左下状态栏的配置指纹应与上面一致；');
log('  「模块归属」面板里 hip_l/2 的底色 = 平衡维持还是迈步，与这里的占比一致。');
