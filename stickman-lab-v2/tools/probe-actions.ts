/**
 * probe-actions.ts —— 手动控制验收：鞠躬 / 单腿站立
 * 用法：node tools/run.mjs probe-actions [bow|oneleg|all]
 */
import './_boot';
import { World } from '../src/core/world';
import { BalanceController } from '../src/core/balance';
import { BOW, buildSingleLeg, evalComTrack, type ActionScript } from '../src/core/actions';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const MODE = (ARGS[0] ?? 'all') as 'bow' | 'oneleg' | 'all';
const WEIGHT = (() => { const w = new World(); return w.sk.massTotal * 9.81; })();

interface Sample {
  t: number; chestX: number; chestY: number; headX: number; headY: number;
  comX: number; comZ: number; fL: number; fR: number; footLY: number; footRY: number;
  hipL: number; kneeL: number; maxW: number;
}

function runAction(a: ActionScript, seconds: number): { samples: Sample[]; worstInv: string[] } {
  const w = new World();
  const bal = new BalanceController(w, {
    gravityComp: true, comKp: 12, comKd: 5, maxForceFrac: 0.35,
    postureTone: 8, lateralControl: true,
  });
  w.controller = bal;
  w.reset();
  bal.manual.play(a.frames, { loop: false, holdEnd: true });
  const ci = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3') ?? 0;
  const hi = w.body.indexByKey.get('head') ?? 0;
  const fL = w.body.indexByKey.get('foot_l') ?? 0;
  const fR = w.body.indexByKey.get('foot_r') ?? 0;
  const hipI = w.body.dofByName('hip_l', 2);
  const kneeI = w.body.dofByName('knee_l', 2);
  const samples: Sample[] = [];
  let worstInv: string[] = [];
  const N = Math.round(seconds / w.dt);
  for (let s = 0; s < N; s++) {
    bal.setComTarget(evalComTrack(a.comTrack, bal.manual.time).x, evalComTrack(a.comTrack, bal.manual.time).z);
    w.advance(1);
    const inv = w.executor.checkInvariants();
    if (inv.length) worstInv = inv;
    if (s % Math.round(0.25 / w.dt) === 0 || s === N - 1) {
      samples.push({
        t: bal.manual.time,
        chestX: w.body.bodies[ci]!.translation().x,
        chestY: w.body.bodies[ci]!.translation().y,
        headX: w.body.bodies[hi]!.translation().x,
        headY: w.body.bodies[hi]!.translation().y,
        comX: bal.telemetry.comX, comZ: bal.telemetry.comZ,
        fL: w.body.footNormalForce('l', w.dt),
        fR: w.body.footNormalForce('r', w.dt),
        footLY: w.body.bodies[fL]!.translation().y,
        footRY: w.body.bodies[fR]!.translation().y,
        hipL: hipI >= 0 ? w.body.dofs[hipI]!.angle : 0,
        kneeL: kneeI >= 0 ? w.body.dofs[kneeI]!.angle : 0,
        maxW: w.totalRelVel(),
      });
    }
  }
  return { samples, worstInv };
}

function printSamples(samples: Sample[]): void {
  console.log('   t    胸y   头x   头y   CoM_x  CoM_z   FzL   FzR  footL_y footR_y  hipL(°) kneeL(°) Σ|ω|');
  for (const s of samples) {
    console.log(
      `  ${s.t.toFixed(2)}  ${s.chestY.toFixed(3)} ${s.headX.toFixed(3).padStart(6)} ${s.headY.toFixed(3)}  ${s.comX.toFixed(3).padStart(6)} ${s.comZ.toFixed(3).padStart(6)}  ${s.fL.toFixed(0).padStart(4)}  ${s.fR.toFixed(0).padStart(4)}   ${s.footLY.toFixed(3)}   ${s.footRY.toFixed(3)}  ${(s.hipL * 180 / Math.PI).toFixed(1).padStart(6)} ${(s.kneeL * 180 / Math.PI).toFixed(1).padStart(7)} ${s.maxW.toFixed(1)}`,
    );
  }
}

function runBow(): void {
  console.log('════ 动作① 鞠躬 ════');
  const { samples, worstInv } = runAction(BOW, 5.0);
  printSamples(samples);
  const rest = samples[0]!;
  const hold = samples.reduce((best, s) => (Math.abs(s.t - 2.3) < Math.abs(best.t - 2.3) ? s : best), samples[0]!);
  const end = samples[samples.length - 1]!;
  const bent = hold.headX - rest.headX;
  const recovered = end.headX - rest.headX;
  const minChestY = Math.min(...samples.map((s) => s.chestY));
  const minFoot = Math.min(...samples.map((s) => Math.min(s.footLY, s.footRY)));
  console.log(`\n  判定：前弯位移 = ${bent.toFixed(3)} m（要求 > 0.15）  回位残差 = ${recovered.toFixed(3)} m（要求 < 0.12）`);
  console.log(`        最低胸高 = ${minChestY.toFixed(3)}（>1.0）  最低脚高 = ${minFoot.toFixed(3)}（≈静息，表示没离地/没穿地）`);
  console.log(`  执行器不变量：${worstInv.length ? worstInv.join(';') : '通过'}`);
  console.log(`        结论：${bent > 0.15 && recovered < 0.12 && minChestY > 1.0 ? '通过 —— 命令被真实执行' : '未通过'}`);
}

function runOneLeg(): void {
  console.log('\n════ 动作② 单腿站立（站右脚、抬左脚）════');
  const w0 = new World();
  const supportZ = w0.body.bodies[w0.body.indexByKey.get('foot_r') ?? 0]!.translation().z;
  const script = buildSingleLeg('r', supportZ);
  const { samples, worstInv } = runAction(script, 5.6);
  printSamples(samples);
  const hold = samples.reduce((best, s) => (Math.abs(s.t - 2.4) < Math.abs(best.t - 2.4) ? s : best), samples[0]!);
  const supportFrac = hold.fR / WEIGHT;
  const liftFrac = hold.fL / WEIGHT;
  const liftH = hold.footLY - samples[0]!.footLY;
  const comErr = Math.abs(hold.comZ - supportZ);
  console.log(`\n  判定（保持相 t≈2.4s）：抬脚高度 = ${(liftH * 100).toFixed(1)} cm（要求 > 8）  抬脚受力 = ${(liftFrac * 100).toFixed(0)}% 体重（要求 < 10%）`);
  console.log(`        支撑脚承重 = ${(supportFrac * 100).toFixed(0)}% 体重（要求 > 65%）  CoM_z 与支撑脚距 = ${(comErr * 100).toFixed(1)} cm（要求 < 8）`);
  console.log(`        胸高 = ${hold.chestY.toFixed(3)}（>1.0）  执行器不变量：${worstInv.length ? worstInv.join(';') : '通过'}`);
  const pass = liftH > 0.08 && liftFrac < 0.10 && supportFrac > 0.65 && comErr < 0.08 && hold.chestY > 1.0;
  console.log(`        结论：${pass ? '通过 —— 命令被真实执行' : '未通过'}`);
}

if (MODE === 'bow' || MODE === 'all') runBow();
if (MODE === 'oneleg' || MODE === 'all') runOneLeg();
