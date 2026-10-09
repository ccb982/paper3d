/**
 * lumbarTrain.ts —— ★ 腰椎训练的**共享内核**（无 DOM；训练页与命令行共用）
 *
 * 场景 / 运行 / 判定（用户定调）：
 *   · 随机条件：随机方向（前/后 55% · 侧 25% · 斜 20%）+ 随机力度 + 30% 二次反向冲量
 *   · 判定 = **回到盆骨位置 + 竖直**（未倒 + 二维回位<5cm + 躯干倾角<0.06 + 脊柱归中
 *     + 末速<0.12）且**冲量**（脊柱/髋 |τ|dt 积分）尽可能少
 *   · jitter 约束：站立 HF ≤ 0.01、挺腰 HF ≤ 150
 * 腿部伺服（垫脚/落地预撑/支撑腿撑住/消力）全程启用，但不参与训练。
 */
import { World } from './world';
import { ControlModule } from './control';
import { applyLumbar, type LumbarParams } from './lumbarPolicy';

export const SPINE_SEGS = ['spine1', 'spine2', 'spine3', 'spine4'] as const;
export const HIP_SEGS = ['hip_l', 'hip_r'] as const;

export const chestY = (w: World): number => w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y;

export type ScType = 'push' | 'hfStand' | 'rise' | 'singleLeg';
export interface Scenario {
  type: ScType;
  /** 单位方向（世界系：x 前后 / z 左右）；hf* 为 0 */
  fx: number; fz: number;
  dv: number;
  label: string;
  /** 二次冲量：at 秒后反向、frac 倍 */
  second?: { at: number; frac: number };
}

export function sampleScenarios(): Scenario[] {
  const rand = (a: number, b: number): number => a + Math.random() * (b - a);
  // ★ 采样策略（用户定调 2026-10）：
  //   · **排除平凡带**（dv < ~0.14：只靠脊柱回弹/被动 + 垫脚就能解决，不值得训）；
  //   · **专训必训带**：脚不动、但**腰不主动挺就会倒**的幅度区——前后方向为主
  //     （后推易倒：腰不往前挺 → 直立恢复失败；前推对称）。
  const mk = (): Scenario => {
    const r = Math.random();
    let fx = 0, fz = 0, dv = 0, label = '';
    if (r < 0.65) {
      // 前后（重点）：必训带
      const back = Math.random() < 0.5;
      fx = back ? -1 : 1;
      dv = back ? rand(0.15, 0.22) : rand(0.15, 0.20);
      label = back ? '后推' : '前推';
    } else if (r < 0.85) {
      fz = Math.random() < 0.5 ? -1 : 1;
      dv = rand(0.12, 0.24);
      label = '侧推';
    } else {
      const th = rand(0, Math.PI * 2);
      fx = Math.cos(th); fz = Math.sin(th);
      dv = rand(0.13, 0.22);
      label = '斜推';
    }
    return {
      type: 'push', fx, fz, dv, label,
      second: Math.random() < 0.3 ? { at: rand(0.25, 0.6), frac: rand(0.4, 0.8) } : undefined,
    };
  };
  return [mk(), mk(), mk(), mk(),
    { type: 'hfStand', fx: 0, fz: 0, dv: 0, label: '站jitter' },
    { type: 'rise', fx: 0, fz: 0, dv: 0, label: '蹬地挺腰' },
    { type: 'singleLeg', fx: 0, fz: 0, dv: 0, label: '单脚(动作全程)' }];
}

export function fixedScenarios(): Scenario[] {
  const p = (label: string, fx: number, fz: number, dv: number): Scenario => ({ type: 'push', fx, fz, dv, label });
  return [
    p('后推', -1, 0, 0.2), p('后推', -1, 0, 0.3),
    p('前推', 1, 0, 0.2), p('前推', 1, 0, 0.3),
    p('侧推', 0, 1, 0.2), p('侧推', 0, -1, 0.3),
    { type: 'hfStand', fx: 0, fz: 0, dv: 0, label: '站jitter' },
    { type: 'rise', fx: 0, fz: 0, dv: 0, label: '蹬地挺腰' },
    { type: 'singleLeg', fx: 0, fz: 0, dv: 0, label: '单脚(动作全程)' },
  ];
}

/** ★ 方向×力度网格（8 方向 × 3 力度） */
export const GRID_MAGS = [0.12, 0.22, 0.32] as const;
export function gridScenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (let k = 0; k < 8; k++) {
    const th = (k * Math.PI) / 4;
    const fx = Math.cos(th), fz = Math.sin(th);
    for (const dv of GRID_MAGS) {
      out.push({ type: 'push', fx, fz, dv, label: `θ${k * 45}°` });
    }
  }
  return out;
}

export interface RunState {
  sc: Scenario; w: World; ctl: ControlModule; t: number; done: boolean;
  ok?: boolean; hs?: number;
  pushed: boolean; pushed2: boolean; minChest: number;
  w0: number; w1: number; jit: number; n: number;
  impDi: number[];
  nSupport: number; nLoad: number; maxDepth: number;
  impulse: number;
  retErr?: number; retFold?: number; endV?: number; endTilt?: number;
  /** rise：胸最高/行程/末胸；singleLeg：抬脚最高 */
  maxChest?: number; stroke?: number; endChest?: number; maxLift?: number;
}
export const SLICE_S = 0.15;
export const OBSERVE_S = 1.8;
export const SETTLE_S = 0.8;

/**
 * ★ Rapier 世界池（关键：训练页会连续跑成百上千个场景，若每场景 `new World()`
 *   而不回收，wasm 世界会堆积 → 页面跑几个动作后卡死。这里一次评估最多并发
 *   24 个场景（网格），池上限 32：新建到 32 个后开始循环复用 + `reset()`。
 *   每个场景在"获取时"reset，保证初始条件干净；池上限 > 最大并发 ⇒ 同一次评估内
 *   不会把正在用的世界又发给别的场景。
 */
const WORLD_POOL: World[] = [];
let worldCursor = 0;
function acquireWorld(): World {
  if (WORLD_POOL.length < 32) {
    const w = new World();
    WORLD_POOL.push(w);
    return w;
  }
  const w = WORLD_POOL[worldCursor % WORLD_POOL.length]!;
  worldCursor++;
  w.reset();
  return w;
}

export function startRun(sc: Scenario, p: LumbarParams): RunState {
  const w = acquireWorld();
  const ctl = new ControlModule(w, { postureTone: 8 });
  applyLumbar(ctl.warner.opt, p);
  ctl.padEnabled = true;
  ctl.landing.opt.enabled = true;
  w.controller = ctl;
  w.reset();
  if (sc.type === 'rise') ctl.actions.play('pushRise');
  if (sc.type === 'singleLeg') ctl.actions.play('singleLegR');
  const impDi: number[] = [];
  for (const s of SPINE_SEGS) { impDi.push(w.body.dofByName(s, 0), w.body.dofByName(s, 2)); }
  for (const s of HIP_SEGS) { impDi.push(w.body.dofByName(s, 0), w.body.dofByName(s, 2)); }
  return {
    sc, w, ctl, t: 0, done: false, pushed: false, pushed2: false, minChest: 9,
    w0: 0, w1: 0, jit: 0, n: 0, impDi, impulse: 0, nSupport: 0, nLoad: 0, maxDepth: 0,
  };
}

export function impulsePush(w: World, fx: number, fz: number, dv: number): void {
  for (const b of w.body.bodies) b.applyImpulse({ x: fx * b.mass() * dv, y: 0, z: fz * b.mass() * dv }, true);
}

export function advanceRun(rs: RunState): void {
  const dt = rs.w.dt;
  const steps = Math.max(1, Math.round(SLICE_S / dt));
  const knee = rs.w.body.dofByName('knee_l', 2);
  const targetX = rs.ctl.warner.opt.standX;
  for (let i = 0; i < steps && !rs.done; i++) {
    const t = rs.t;
    if (rs.sc.type === 'push') {
      if (t < SETTLE_S) rs.ctl.warner.setComTarget(targetX, 0);
      if (!rs.pushed && t >= SETTLE_S) { impulsePush(rs.w, rs.sc.fx, rs.sc.fz, rs.sc.dv); rs.pushed = true; }
      if (rs.sc.second && !rs.pushed2 && t >= SETTLE_S + rs.sc.second.at) {
        impulsePush(rs.w, -rs.sc.fx, -rs.sc.fz, rs.sc.dv * rs.sc.second.frac);
        rs.pushed2 = true;
      }
      rs.w.advance(1);
      if (t >= SETTLE_S) {
        rs.minChest = Math.min(rs.minChest, chestY(rs.w));
        for (const di of rs.impDi) {
          if (di >= 0) rs.impulse += Math.abs(rs.w.executor.ledger[di]!.applied) * dt;
        }
        const prop = rs.ctl.lastProposal;
        if (prop) {
          for (const d of prop.reflexDirectives) {
            if (d.id === 'support') rs.nSupport++;
            else if (d.id === 'load') rs.nLoad++;
          }
        }
        rs.maxDepth = Math.max(rs.maxDepth, rs.ctl.landing.depthOf(0), rs.ctl.landing.depthOf(1));
      }
      if (t >= SETTLE_S + OBSERVE_S) {
        const dx = rs.ctl.sensors.com[0]! - targetX;
        const dz = rs.ctl.sensors.com[2]!;
        const vx = rs.ctl.sensors.comVel[0]!, vz = rs.ctl.sensors.comVel[2]!;
        rs.retErr = Math.hypot(dx, dz);
        rs.endV = Math.hypot(vx, vz);
        rs.endTilt = Math.hypot(rs.ctl.sensors.torsoTilt[0]!, rs.ctl.sensors.torsoTilt[1]!);
        let fold = 0;
        for (const s of SPINE_SEGS) {
          const d2 = rs.w.body.dofByName(s, 2), d0 = rs.w.body.dofByName(s, 0);
          if (d2 >= 0) fold = Math.max(fold, Math.abs(rs.w.body.dofs[d2]!.angle));
          if (d0 >= 0) fold = Math.max(fold, Math.abs(rs.w.body.dofs[d0]!.angle));
        }
        rs.retFold = fold;
        rs.ok = chestY(rs.w) > 1.2 && rs.retErr < 0.05 && fold < 0.06
          && rs.endTilt < 0.06 && rs.endV < 0.12;
        rs.done = true;
      }
    } else if (rs.sc.type === 'rise') {
      // ★ 蹬地挺腰（动作全程）：行程>3cm 且末胸>1.3（probe-control C 判据）+ 动作期 HF（硬门）
      rs.w.advance(1);
      const cy = chestY(rs.w);
      rs.minChest = Math.min(rs.minChest, cy);
      if (cy > (rs.maxChest ?? 0)) rs.maxChest = cy;
      const v = rs.w.body.dofs[knee]!.vel;
      const d2 = v - 2 * rs.w1 + rs.w0;
      if (t > 1.0 && t < 2.2) { rs.jit += d2 * d2; rs.n++; }
      rs.w0 = rs.w1; rs.w1 = v;
      for (const di of rs.impDi) if (di >= 0) rs.impulse += Math.abs(rs.w.executor.ledger[di]!.applied) * dt;
      if (t >= 3.0) {
        rs.stroke = (rs.maxChest ?? 0) - rs.minChest;
        rs.hs = rs.jit / Math.max(1, rs.n);
        rs.endChest = cy;
        rs.ok = rs.stroke > 0.03 && cy > 1.3;
        rs.done = true;
      }
    } else if (rs.sc.type === 'singleLeg') {
      // ★ 单脚（动作全程 6s）：抬脚>5cm 且最低胸>1.25（probe-control D 判据）+ 结束回位/竖直/落定
      rs.w.advance(1);
      const lift = rs.ctl.sensors.feet[0]!.y - 0.068;
      if (lift > (rs.maxLift ?? 0)) rs.maxLift = lift;
      rs.minChest = Math.min(rs.minChest, chestY(rs.w));
      for (const di of rs.impDi) if (di >= 0) rs.impulse += Math.abs(rs.w.executor.ledger[di]!.applied) * dt;
      if (t >= 6.0) {
        const dx = rs.ctl.sensors.com[0]! - rs.ctl.warner.opt.standX;
        const dz = rs.ctl.sensors.com[2]!;
        rs.retErr = Math.hypot(dx, dz);
        rs.endV = Math.hypot(rs.ctl.sensors.comVel[0]!, rs.ctl.sensors.comVel[2]!);
        rs.endTilt = Math.hypot(rs.ctl.sensors.torsoTilt[0]!, rs.ctl.sensors.torsoTilt[1]!);
        rs.ok = (rs.maxLift ?? 0) > 0.05 && rs.minChest > 1.25
          && rs.retErr < 0.06 && rs.endTilt < 0.08 && rs.endV < 0.15;
        rs.done = true;
      }
    } else {
      // 站立 jitter（hfStand）：2.4s，窗口 [1.0,2.2] 测 HF（★ 这个 else 必须保留——
      // 之前被 rise/singleLeg 分支覆盖，hfStand 永不 done → 训练卡死在不更新）
      rs.w.advance(1);
      const v = rs.w.body.dofs[knee]!.vel;
      const d2 = v - 2 * rs.w1 + rs.w0;
      if (t > 1.0 && t < 2.2) { rs.jit += d2 * d2; rs.n++; }
      rs.w0 = rs.w1; rs.w1 = v;
      if (t >= 2.4) { rs.hs = rs.jit / Math.max(1, rs.n); rs.done = true; }
    }
    rs.t += dt;
  }
}

export interface EvalResult { fit: number; rec: number; hs: number; hp: number; rows: string[] }
const fmtV = (v: number | undefined): string => (v === undefined || !isFinite(v) ? '—' : v.toFixed(3));

export function evaluate(rsList: RunState[]): EvalResult {
  let rec = 0, hs = 0, hp = 0, fit = 0;
  const rows: string[] = [];
  for (const r of rsList) {
    if (r.sc.type === 'push') {
      const pen = 0.012 * r.impulse;
      fit += (r.ok ? 10 : 0) - pen;
      if (r.ok) rec++;
      rows.push(
        `${r.sc.label} dv=${r.sc.dv.toFixed(2)}${r.sc.second ? '+二次' : ''}：` +
        `${r.ok ? '回位 ✓' : '未回位 ✗'}（err=${fmtV(r.retErr)} 倾角=${fmtV(r.endTilt)} 残fold=${fmtV(r.retFold)}` +
        ` 冲量=${r.impulse.toFixed(0)} 最低胸=${r.minChest.toFixed(2)}` +
        ` 腿伺服[预撑×${r.nSupport} 撑住×${r.nLoad} 消力${r.maxDepth.toFixed(2)}]）`);
    } else if (r.sc.type === 'hfStand') {
      hs = r.hs ?? 9;
      rows.push(`站立 jitter：HF=${hs.toExponential(2)}`);
    } else if (r.sc.type === 'rise') {
      hp = r.hs ?? 9;
      fit += (r.ok ? 10 : 0) - 0.012 * r.impulse;
      if (r.ok) rec++;
      rows.push(
        `蹬地挺腰：${r.ok ? '生效且站住 ✓' : '未生效/未站住 ✗'}（行程=${((r.stroke ?? 0) * 100).toFixed(1)}cm` +
        ` 末胸=${fmtV(r.endChest)} 挺腰HF=${hp.toExponential(2)} 冲量=${r.impulse.toFixed(0)}）`);
    } else {
      fit += (r.ok ? 10 : 0) - 0.012 * r.impulse;
      if (r.ok) rec++;
      rows.push(
        `单脚(动作全程)：${r.ok ? '抬起且站住 ✓' : '未达成 ✗'}（抬脚=${((r.maxLift ?? 0) * 100).toFixed(1)}cm` +
        ` 最低胸=${r.minChest.toFixed(2)} err=${fmtV(r.retErr)} 倾角=${fmtV(r.endTilt)} 冲量=${r.impulse.toFixed(0)}）`);
    }
  }
  // ★ 抖动 = **硬门**（支配性罚分）：ES 永远不该拿"站稳/挺腰变抖"换恢复分
  fit += hs > 0.01 ? -1000 : 5;
  fit += hp > 150 ? -1000 : hp < 100 ? 2 : 0;
  return { fit, rec, hs, hp, rows };
}
