/**
 * probe-control.ts —— 控制模块（整合器）验收：站立 + 鞠躬（走新路径）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { ProgramRunner } from '../src/core/program';
import { BOW, evalComTrack } from '../src/core/actions';

// A) 站立 5s
{
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  const chest = w.body.indexByKey.get('spine4') ?? 0;
  for (let s = 0; s < Math.round(5 / w.dt); s++) w.advance(1);
  const y = w.body.bodies[chest]!.translation().y;
  console.log(`A 站立 5s：胸y=${y.toFixed(4)}  提案level=${ctl.lastProposal?.level}  reason=${ctl.lastProposal?.reason}  ${y > 1.3 ? '站住' : '未站住'}`);
}

// B) 鞠躬（动作层出提案 → 控制模块整合；伺服层同时工作）
{
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  const chest = w.body.indexByKey.get('spine4') ?? 0;
  const head = w.body.indexByKey.get('head') ?? 0;
  const x0 = w.body.bodies[head]!.translation().x;
  ctl.actions.play('bow');
  let bent = 0, minChest = Infinity;
  for (let s = 0; s < Math.round(5 / w.dt); s++) {
    w.advance(1);
    const t = s * w.dt;
    if (Math.abs(t - 2.3) < w.dt / 2) bent = w.body.bodies[head]!.translation().x - x0;
    const cy = w.body.bodies[chest]!.translation().y;
    if (cy < minChest) minChest = cy;
  }
  const rec = w.body.bodies[head]!.translation().x - x0;
  console.log(`B 鞠躬：前弯=${bent.toFixed(3)}m（>0.15）  回位残差=${rec.toFixed(3)}m（<0.12）  最低胸y=${minChest.toFixed(3)}  ${bent > 0.15 && Math.abs(rec) < 0.12 && minChest > 1.0 ? '通过' : '未通过'}`);
}

// C) 蹬地挺腰（力矩关键帧，经控制模块写入 Executor）
{
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  if (process.env.BEND_SIGN !== undefined) ctl.warner.opt.bendSign = Number(process.env.BEND_SIGN);
  if (process.env.NO_LANDING === '1') ctl.landing.opt.enabled = false;
  w.controller = ctl;
  w.reset();
  const chest = w.body.indexByKey.get('spine4') ?? 0;
  const weight = w.sk.massTotal * 9.81;
  ctl.actions.play('pushRise');
  let minChest = Infinity, maxChest = 0, maxFz = 0, finalChest = 0;
  const knee = w.body.dofByName('knee_l', 2);
  let peakKneeTau = 0;
  for (let s = 0; s < Math.round(3 / w.dt); s++) {
    w.advance(1);
    const cy = w.body.bodies[chest]!.translation().y;
    if (cy < minChest) minChest = cy;
    if (cy > maxChest) maxChest = cy;
    finalChest = cy;
    const fz = w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt);
    if (fz > maxFz) maxFz = fz;
    const t = Math.abs(w.executor.ledger[knee]!.applied);
    if (t > peakKneeTau) peakKneeTau = t;
  }
  const stroke = maxChest - minChest;
  console.log(`C 蹬地挺腰：胸y ${minChest.toFixed(3)}→${maxChest.toFixed(3)}（行程 ${(stroke * 100).toFixed(1)}cm）  末胸=${finalChest.toFixed(3)}  Fz峰值=${(maxFz / weight * 100).toFixed(0)}%体重  膝τ峰值=${peakKneeTau.toFixed(0)}N·m  ${stroke > 0.03 && finalChest > 1.3 ? '生效且站住' : '未生效/未站住'}`);
}

// D) 单脚站立（相位节目：重心转移→抬腿→落腿触地）
{
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  ctl.actions.play('singleLegR');
  const chest = w.body.indexByKey.get('spine4') ?? 0;
  let maxLift = 0, phases = new Set<string>(), minChest = Infinity, finalLfz = 0;
  for (let s = 0; s < Math.round(6 / w.dt); s++) {
    w.advance(1);
    const ph = ctl.actions.status.phase;
    if (ph) phases.add(ph);
    const ly = ctl.sensors.feet[0]!.y;
    const lift = ly - 0.068;
    if (lift > maxLift) maxLift = lift;
    const cy = w.body.bodies[chest]!.translation().y;
    if (cy < minChest) minChest = cy;
    finalLfz = ctl.sensors.feet[0]!.fz;
  }
  console.log(`D 单脚站立：相位=${[...phases].join('→')}  抬脚最高=${(maxLift * 100).toFixed(1)}cm  最低胸=${minChest.toFixed(3)}  末抬脚Fz=${finalLfz.toFixed(0)}N  ${maxLift > 0.05 && minChest > 1.25 ? '抬起且站住' : maxLift > 0.05 ? '抬起但过程中失稳' : '未抬起（安全放弃）'}`);
}

// E) 蹲起（动作层新动作）：下蹲→蹲底保持→站起；全程不离地、末态站住
{
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  const chest = w.body.indexByKey.get('spine4') ?? 0;
  const weight = w.sk.massTotal * 9.81;
  ctl.actions.play('squatRise');
  let minChest = Infinity, maxChest = 0, finalChest = 0, maxFz = 0, airFrames = 0;
  let maxTilt = 0, minComX = 9, maxComX = -9;
  for (let s = 0; s < Math.round(3.5 / w.dt); s++) {
    w.advance(1);
    const cy = w.body.bodies[chest]!.translation().y;
    if (cy < minChest) minChest = cy;
    if (cy > maxChest) maxChest = cy;
    finalChest = cy;
    const fz = w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt);
    if (fz > maxFz) maxFz = fz;
    if (s > 96 && fz < 10) airFrames++;      // 起步 0.2s 后双脚离地帧数
    const t = s * w.dt;
    if (t > 0.3 && t < 2.6) {
      maxTilt = Math.max(maxTilt, Math.abs(ctl.sensors.torsoTilt[0]!));   // ★ 上身竖直度
      minComX = Math.min(minComX, ctl.sensors.com[0]!);                   // ★ 重心漂移
      maxComX = Math.max(maxComX, ctl.sensors.com[0]!);
    }
  }
  const stroke = maxChest - minChest;
  const noAir = airFrames === 0;
  console.log(`E 蹲起：胸y ${minChest.toFixed(3)}→${maxChest.toFixed(3)}（行程 ${(stroke * 100).toFixed(1)}cm）  末胸=${finalChest.toFixed(3)}` +
    `  Fz峰值=${(maxFz / weight * 100).toFixed(0)}%体重  离地帧=${airFrames}  ` +
    `躯干最大倾角=${(maxTilt * 180 / Math.PI).toFixed(1)}°  comX∈[${minComX.toFixed(3)},${maxComX.toFixed(3)}]  ` +
    `${noAir && finalChest > 1.3 && stroke > 0.03 ? '蹲起且站住' : noAir && finalChest > 1.3 ? '站住但行程小' : '未达标'}`);
}

// F) 蹲起时序诊断（临时）：t / comX / 胸 / 膝角 / 髋角 / 踝角 / 躯干倾角
{
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  ctl.actions.play('squatRise');
  const knL = w.body.dofByName('knee_l', 2), hiL = w.body.dofByName('hip_l', 2), foL = w.body.dofByName('foot_l', 2);
  for (let s = 0; s < Math.round(2.2 / w.dt); s++) {
    w.advance(1);
    if (s % 48 === 0) {
      console.log(`F t=${(s * w.dt).toFixed(2)} comX=${ctl.sensors.com[0]!.toFixed(3)} 胸=${w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y.toFixed(3)}` +
        ` 膝=${w.body.dofs[knL]!.angle.toFixed(3)} 髋=${hiL >= 0 ? w.body.dofs[hiL]!.angle.toFixed(3) : '-'} 踝=${foL >= 0 ? w.body.dofs[foL]!.angle.toFixed(3) : '-'}` +
        ` 倾角=${(ctl.sensors.torsoTilt[0]! * 180 / Math.PI).toFixed(1)}°`);
    }
  }
}
