/**
 * probe-archrise.ts —— 弓要降到多低才真的承重？
 *
 * 机理：弓区在内侧（fz .40..1.00），承重窄条在外侧（fz≈−63mm），间距 126mm。
 *       弓底面比鞋底高 `rise` ⇒ 要让它接地需旋前 `asin(rise/126)`。
 * 实测：rise=22mm ⇒ 需 10°，而脚实际只倾 1.93~7.45° ⇒ 弓 480 帧零接触。
 * 本探针直接扫 rise，看哪一档开始承重。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any; const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const RAPIER = await import('@dimforge/rapier3d');
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const log = console.log;
const PHz = DEFAULT_SIM.physicsHz ?? 240;
/** 只扫这一档（默认当前配置的 archRise）；想扫全谱把序列改回 [0,4,6,9,12,16,22] */
const RISE_ONLY = (DEFAULT_CONFIG.archRise ?? 0) * 1000;

function trial(riseMm: number) {
  const sk = buildSkeleton({ ...DEFAULT_CONFIG, archRise: riseMm / 1000 });
  const SHAPE = shapeForJoints(sk.joints.length);
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand' });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
  const d = sim.doll;
  const wd = (d as any).world as InstanceType<typeof RAPIER.World>;
  const ja = jointIndexByName(sk, 'arch_l');
  const jAnkle = jointIndexByName(sk, 'foot_l');
  // ★ 弓的承重要用**关节力**测，不能用接触冲量：
  //   真实足弧是连接足跟与前足的**承力构件**（像弓弦一样受拉），
  //   足踝来的载荷经距骨→舟骨→楔骨→第一跳骨 全程经过它。
  //   所以它**不接地也在承重**。只测「法向接触冲量」只能测到「它自己压在地上」。
  const JF = new Float64Array(sk.joints.length * 5);
  const iA = sk.bodies.findIndex((b) => b.key === 'arch_l');
  const iF = sk.bodies.findIndex((b) => b.key === 'foot_l');
  const archB = d.bodies[iA]!, nC = archB.numColliders();
  const COP = new Float64Array(8), BB = new Float64Array(4), LD = new Float64Array(8);
  const ROT = new Float64Array(3);
  let frames = 0, hit = 0, aMin = 9, aMax = -9, lamSum = 0, lamPk = 0;
  const archF: number[] = [], ankleF: number[] = [];
  const cops: number[] = [], tilt: number[] = [];
  // ⚠ 帧数直接决定耗时：每个 rise 都要**重建 Rapier World**（wasm 初始化 + 碰撞体构建）。
  //   3 个 rise × 720 帧 → 几十秒；改成 1 个 rise × 240 帧 → 几秒。扫描时把帧数加回去。
  const N = Math.round(PHz * 1.0), skip = Math.round(PHz * 0.4);
  for (let f = 0; f < N; f++) {
    sim.motor.set(ctrl.step(1 / (DEFAULT_SIM.controlHz ?? 120)));
    sim.advance(1);
    if (f < skip) continue;
    frames++;
    d.jointRot(ja, ROT);          // ★ 读自由轴 X，不是 jointAngle()（那个返回 Z）
    const a = ROT[0];
    aMin = Math.min(aMin, a); aMax = Math.max(aMax, a);
    let lam = 0;
    for (let c = 0; c < nC; c++) {
      const col = archB.collider(c);
      wd.contactPairsWith(col, (other: any) => {
        wd.contactPair(col, other, (mf: any) => {
          if (mf.numContacts() === 0) return;
          for (let k = 0; k < mf.numContacts(); k++) lam += Math.abs(mf.contactImpulse(k));
        });
      });
    }
    if (lam > 1e-9) hit++;
    lamSum += lam; lamPk = Math.max(lamPk, lam);
    d.jointForce(JF, 1 / PHz);
    // 关节力：out[i*5+0..2] = 载荷向量（正=[向子体推），[3]=上向分量
    archF.push(Math.hypot(JF[ja * 5]!, JF[ja * 5 + 1]!, JF[ja * 5 + 2]!));
    ankleF.push(Math.hypot(JF[jAnkle * 5]!, JF[jAnkle * 5 + 1]!, JF[jAnkle * 5 + 2]!));
    d.readCoP(0, COP); d.footSoleBounds(0, BB); d.soleBlockLoad(0, LD);
    cops.push(COP[2]!); tilt.push(d.tiltOf(d.bodies[iF]!));
  }
  const n = (d as any).soleCols[0].length;
  const names = (d as any).soleBlockLabels(0);
  let tot = 0;
  for (let i = 0; i < n; i++) tot += LD[i]!;
  // 归一化到「外侧柱」那一项（索引由真实块名定，不写死）
  const li = names.findIndex((x: string) => x.includes('外侧柱'));
  const archIdx = names.map((x: string, i: number) => [x, i] as const)
    .filter(([x]) => x.includes('内侧弓')).map(([, i]) => i);
  const archSum = archIdx.reduce((a: number, i: number) => a + (LD[i] ?? 0), 0);
  // 逐块并排：直接读 contactImpulse vs 走 soleBlockLoad，定位彩虽在哪一层
  const cols = (d as any).soleCols[0] as any[];
  const direct: number[] = [];
  for (let c = 0; c < cols.length; c++) {
    let lam = 0;
    wd.contactPairsWith(cols[c], (other: any) => {
      wd.contactPair(cols[c], other, (mf: any) => {
        if (mf.numContacts() === 0) return;
        for (let k = 0; k < mf.numContacts(); k++) lam += Math.abs(mf.contactImpulse(k));
      });
    });
    direct.push(lam);
  }
  return {
    names, n, li, archIdx, direct, viaLd: [...LD.slice(0, n)],
    bbZ: `${(BB[2] * 1000).toFixed(0)}..${(BB[3] * 1000).toFixed(0)}`,
    hitPct: hit / Math.max(1, frames) * 100,
    aRange: (aMax - aMin) * 57.3, aMean: ((aMin + aMax) / 2) * 57.3,
    lamPk, archShare: tot > 1e-9 ? (archSum / tot) * 100 : 0,
    copR: (Math.max(...cops) - Math.min(...cops)) * 1000,
    archF: archF.reduce((a, b) => a + b, 0) / Math.max(1, archF.length),
    ankleF: ankleF.reduce((a, b) => a + b, 0) / Math.max(1, ankleF.length),
    archFMax: archF.reduce((a, b) => Math.max(a, b), 0),
    tiltR: (Math.max(...tilt) - Math.min(...tilt)) * 57.3,
  };
}

log('══ 弓升起高度扫描：多低才承重？══');
log('   （需旋前角 = asin(rise/126mm)；脚实测只能倾 ~2~7°）');
log('');
log('   rise   需旋前   弓接触帧   弓角行程   弓角均值   弓载荷峰   弓承重%   CoP行程   足倾角行程');
for (const r of [RISE_ONLY]) {
  const t = trial(r);
  const need = (Math.asin(Math.min(1, r / 126)) * 57.3).toFixed(1);
  log(`   ${String(r).padStart(3)}mm  ${need.padStart(6)}°`
    + `   块[${t.names.join('|')}]`
    + `   直读λ[${t.direct.map((v) => v.toFixed(3)).join('|')}]`
    + `   soleBlockLoad[${t.viaLd.map((v) => v.toFixed(3)).join('|')}]`
    + `   bb z[${t.bbZ}]`
    + `   弓关节力均 ${t.archF.toFixed(0).padStart(5)}N 峰 ${t.archFMax.toFixed(0).padStart(4)}N`
    + `  (跳关节力均 ${t.ankleF.toFixed(0)}N)`
    + `   ${t.hitPct.toFixed(0).padStart(5)}%`
    + `   ${t.aRange.toFixed(2).padStart(7)}°`
    + `   ${t.aMean.toFixed(2).padStart(7)}°`
    + `   ${t.lamPk.toFixed(3).padStart(8)}`
    + `   ${t.archShare.toFixed(1).padStart(6)}%`
    + `   ${t.copR.toFixed(1).padStart(6)}mm`
    + `   ${t.tiltR.toFixed(2).padStart(7)}°`
    + `   ${t.hitPct > 20 ? '\u2713 \u627f\u91cd' : ''}`);
}
