/** kernel.ts —— 伺服共享内核（只提取机制，不删任何现有参数/路径）
 *
 * 从站立链路中提取的、所有伺服状态本质相同的机制：
 *   · 关节有效惯量（子树质量绕关节轴）
 *   · PD（Kp·e + Kd·(−v)）
 *   · Peterka Loop2 延迟环（力矩历史低通 → dev2）
 *   · CoP 低通外环
 *   · 限幅/软限位
 *
 * 参数（Kp/Kd/Ktorq/Fc/延迟/软限位…）全部由调用方（状态表/env）传入——本模块无状态常量。
 * 滤波器状态按 key 分桶；key 必须包含状态（如 "stand:hip_r:2"），切状态时 reset。
 */
import type { Body } from '../body';
import { baseTq, baseAng } from './baseTable';

/** 关节有效惯量：子树质量绕关节轴的转动惯量 */
export function effInertia(body: Body, dofIndex: number): number {
  const d = body.dofs[dofIndex];
  if (!d) return 0;
  const a = d.anchorWorld;
  const u = d.axisWorld;
  let I = 0;
  for (const bi of body.subtree[d.joint] ?? []) {
    const rb = body.bodies[bi]!;
    const c = rb.worldCom();
    const rx = c.x - a[0]!;
    const ry = c.y - a[1]!;
    const rz = c.z - a[2]!;
    const cx = ry * u[2]! - rz * u[1]!;
    const cy = rz * u[0]! - rx * u[2]!;
    const cz = rx * u[1]! - ry * u[0]!;
    I += rb.mass() * (cx * cx + cy * cy + cz * cz);
  }
  return I;
}

/** PD（dev 版）：dev 已是处理后的误差（如 Loop2 的 dev2） */
export function pdDev(kp: number, kd: number, dev: number, vel: number): number {
  return kp * dev - kd * vel;
}

/** 单向阻尼 PD：只在偏离方向与速度同号时阻尼（脊柱/颈姿态保持的原始语义） */
export function pdDevOneWay(kp: number, kd: number, dev: number, vel: number): number {
  return kp * dev + (dev * vel > 0 ? -kd * vel : 0);
}

/** PD：位置回正 + 速度阻尼（D 项） */
export function pd(kp: number, kd: number, ref: number, angle: number, vel: number): number {
  return kp * (ref - angle) - kd * vel;
}

/** 基础力（前馈）：状态表查表——唯一读取入口（站立/蹲姿/摆动侧同一函数） */
export function baseTorque(jn: string, ax: number, sup = true): number {
  return baseTq(jn, ax, sup);
}

/** 目标角（状态表）：回正力 ref 的唯一读取入口 */
export function baseRef(jn: string, ax: number): number | undefined {
  return baseAng(jn, ax);
}

/** 力矩限幅 */
export function clamp(tau: number, lim: number): number {
  return tau > lim ? lim : tau < -lim ? -lim : tau;
}

/** Peterka Loop2：dev2 = e + Ktorq·LP(τ(t−Δ))；滤波器状态按 key 分桶 */
export class Loop2 {
  private readonly hist = new Map<string, Float64Array>();
  private readonly lp = new Map<string, number>();
  private frame = 0;

  tick(): void { this.frame++; }
  reset(): void { this.hist.clear(); this.lp.clear(); this.frame = 0; }

  dev2(key: string, e: number, ktorq: number, fcHz = 1.5, delayF = 36): number {
    const aT = 1 - Math.exp(-(1 / 240) * 2 * Math.PI * fcHz);
    let buf = this.hist.get(key);
    if (!buf) { buf = new Float64Array(64); this.hist.set(key, buf); }
    const tcPrev = buf[((this.frame - delayF) % 64 + 64) % 64]!;
    const lpPrev = this.lp.get(key) ?? 0;
    const tcLp = lpPrev + (tcPrev - lpPrev) * aT;
    this.lp.set(key, tcLp);
    return e + ktorq * tcLp;
  }

  /** 本帧算出的回正力矩回写到历史（供 delayF 帧后使用） */
  write(key: string, tau: number): void {
    let buf = this.hist.get(key);
    if (!buf) { buf = new Float64Array(64); this.hist.set(key, buf); }
    buf[this.frame % 64] = tau;
  }
}

/** CoP 低通外环：Kc·(XCoM − CoP_lp)；状态按 key 分桶 */
export class CopLoop {
  private readonly lp = new Map<string, number>();
  private readonly rel = new Map<string, number>();

  reset(): void { this.lp.clear(); this.rel.clear(); }

  /** 站立原实现：CoP 相对初值的低通（按状态分桶，左右腿共享） */
  relTerm(key: string, copNow: number, cop0: number, fcHz = 1.5): number {
    const a = 1 - Math.exp(-(1 / 240) * 2 * Math.PI * fcHz);
    const prev = this.rel.get(key) ?? 0;
    const lp = prev + ((copNow - cop0) - prev) * a;
    this.rel.set(key, lp);
    return lp;
  }

  outer(key: string, kc: number, xcom: number, cop: number, fcHz = 1.5): number {
    const aT = 1 - Math.exp(-(1 / 240) * 2 * Math.PI * fcHz);
    const prev = this.lp.get(key) ?? cop;
    const lp = prev + (cop - prev) * aT;
    this.lp.set(key, lp);
    return kc * (xcom - lp);
  }
}

/** ★《唯一阻尼系统设计》：共享阻尼（唯一实现；公式从 drive/张力层原样迁移）
 *  返三分量：td（damp 桶）/ srs（原 tex 桶）/ ow（张力提案）——桶不变，只集中公式 */
export function dampTorque(a: {
  part: string; vel: number; velPrev: number; tauMax: number; inertiaLow: number;
  velMax: number; inertia: number; dev: number; outward: boolean; dt: number;
  b: number; kd: number; tgt: number; acted: boolean; srsK: number; kdBase: number;
}): { td: number; srs: number; ow: number } {
  const { part, vel, velPrev, tauMax, inertiaLow, velMax, inertia, dev, outward, dt, b, kd, tgt, acted, srsK, kdBase } = a;
  // ── td（drive.ts 原公式：B + vAvg + 0.5τmax 限幅 + inertiaLow 上限）──
  let B = b;
  if (!Number.isNaN(tgt)) B += Number.isNaN(kd) ? 0.02 * Math.max(10, tauMax) : kd;
  B = Math.min(B, 0.8 * Math.max(1e-9, inertiaLow) / dt);
  let td = 0;
  if (B > 0 && vel !== 0) {
    const vAvg = 0.5 * (vel + velPrev);
    td = -B * vAvg;
    const cap = 0.5 * tauMax;
    td = Math.max(-cap, Math.min(cap, td));
  }
  if (velMax > 0 && Math.abs(vel) > velMax) {
    const over = Math.abs(vel) - velMax;
    const kBrake = Math.min(80, 0.5 * 2 * Math.max(1e-9, inertia) / dt);
    td += -Math.sign(vel) * Math.min(over * kBrake, tauMax);
  }
  // ── srs（原 drive.ts:382，写 tex 桶）──
  const srs = part === 'spine' && !acted && srsK > 0 ? -srsK * vel : 0;
  // ── ow（原 stability 张力层）──
  const ow = outward ? -Math.min(70, kdBase + Math.abs(dev) * 280) * vel : 0;
  return { td, srs, ow };
}
