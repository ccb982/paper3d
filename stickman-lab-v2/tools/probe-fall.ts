/**
 * probe-fall.ts —— 跌倒急救验收：绷直（落地保护）在"跌已不可避免"后触发
 * 对比：不急救 vs 急救（giveup → 动作层保护动作 fallProtect，架构.md §3.8）
 * 判据：急救应压低**落地冲击**（峰值 Σ|ω|、头部最低点、关节被摔幅度），
 *       而不是"救回平衡"（那是垫脚的职责，已单独验证）。
 */
import './_boot';
import { World } from '../src/core/world';
import { StabilityWarner } from '../src/core/stability';
import { Sensors } from '../src/core/sensors';
import { ActionSystem } from '../src/core/actionSystem';
import { RecoveryReflexes } from '../src/core/reflex';

interface FallOut { peakOmega: number; minChest: number; minHead: number; finalChest: number; giveUpAt: number; }

function run(dv: number, firstAid: boolean): FallOut {
  const w = new World();
  const bal = new StabilityWarner(w, {
    gravityComp: true, comKp: 0, comKd: 0, maxForceFrac: 0.35,
    postureTone: 8, lateralControl: false,
    ankleStrategy: false, postureSkipAnkles: true,
  });
  // 控制器适配器：预警（只读）+ 平衡基建（重力补偿/姿态张力）。
  // 旧 warner.step() 已删除（只提案架构），本探针场景=无平衡救援、只有反射垫脚+急救。
  w.controller = {
    step: () => {
      bal.manual.step(w.dt);      // 直控命令施加（最高优先级入口）
      bal.propose();
      bal.contributeBaseline();
    },
  };
  w.reset();
  const sn = new Sensors(w);
  const rx = new RecoveryReflexes(w, sn);
  const acts = new ActionSystem(w, bal, sn);
  if (firstAid) rx.onGiveUp = () => acts.play('fallProtect');
  const chest = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3') ?? 0;
  const head = w.body.indexByKey.get('head') ?? 0;
  let pushed = false, peakOmega = 0, minChest = Infinity, minHead = Infinity;
  let giveUpAt = -1;
  const N = Math.round(3.0 / w.dt);
  for (let s = 0; s < N; s++) {
    const t = s * w.dt;
    if (!pushed && t >= 0.5) {
      for (const b of w.body.bodies) b.applyImpulse({ x: b.mass() * dv, y: 0, z: 0 }, true);
      pushed = true;
    }
    sn.update(w.dt);
    w.advance(1, () => {
      rx.comTargetX = 0; rx.comTargetZ = 0;
      rx.step(w.dt);
      if (firstAid) acts.step(w.dt);
    });
    if (rx.mode === 'giveup' && giveUpAt < 0) giveUpAt = t;
    const sw = w.totalRelVel();
    if (sw > peakOmega) peakOmega = sw;
    const cy = w.body.bodies[chest]!.translation().y;
    const hy = w.body.bodies[head]!.translation().y;
    if (cy < minChest) minChest = cy;
    if (hy < minHead) minHead = hy;
  }
  return {
    peakOmega,
    minChest,
    minHead,
    finalChest: w.body.bodies[chest]!.translation().y,
    giveUpAt,
  };
}

console.log('════ 跌倒急救（0.6 m/s 推，不可救）════');
console.log('配置        giveup时刻  峰值Σ|ω|  最低胸y  最低头y  末胸y');
for (const aid of [false, true]) {
  const r = run(0.6, aid);
  console.log(
    `${aid ? '急救(绷直)  ' : '不急救       '} ${r.giveUpAt.toFixed(2)}s      ${r.peakOmega.toFixed(0).padStart(6)}   ${r.minChest.toFixed(3)}    ${r.minHead.toFixed(3)}    ${r.finalChest.toFixed(3)}`,
  );
}
