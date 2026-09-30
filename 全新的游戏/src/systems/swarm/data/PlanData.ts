// ============================================================
// data/PlanData —— 落点计划 / 活动环 / 施工带 / 防区锁（2026-09-30 从 SwarmData 抽出）
// ============================================================
// 只做"计划与环"的数据：落点 DefensePlan、p 驱动的环边界、施工带公式、
// 环夹取、防区楔形夹取。事态 p 由调用方传入（本类不做事态）。
// ============================================================

import { clampAngleToSector, angleOfPoint, secOfPoint } from '../Sectors';
import type { DefensePlan } from '../LandingTerrain';

export interface RingBand {
  rLo: number; rHi: number; minD: number; maxD: number; frontP: number; pushM: number;
}

export class PlanData {
  private plan: DefensePlan | null = null;
  /** ★ 工程阶段（S0 勘察 → S1 施工 → S2 就绪） */
  stage: 'S0' | 'S1' | 'S2' = 'S0';
  /** ★ 前推棘轮里程（事态控制；每拍 ≤1m） */
  private pushM = 0;
  private frontMinD = -1;
  private frontMaxD = -1;
  private sx = 0;
  private sz = 0;
  private ringClock = 1;
  /** 命令夹环计数（探针/调试） */
  clamps = 0;

  get defensePlan(): DefensePlan | null { return this.plan; }
  setPlan(p: DefensePlan | null): void { this.plan = p; }
  get lastX(): number { return this.sx; }
  get lastZ(): number { return this.sz; }
  get outerMax(): number { return this.frontMaxD; }
  ship(): { x: number; z: number } { return { x: this.sx, z: this.sz }; }
  /** 拖动时间轴/恢复实时 → 下一拍立即重算环 */
  resetClock(): void { this.ringClock = 1; }

  ring(): { minD: number; maxD: number; cx: number; cz: number } {
    return { minD: this.frontMinD, maxD: this.frontMaxD, cx: this.sx, cz: this.sz };
  }

  /** ★ 施工带（事态函数口径，单源；总攻不收敛为点） */
  band(frontP: number): RingBand {
    const rLo = Math.max(24, this.frontMinD + 8);
    const rHiBase = Math.max(90, rLo + 30) + this.pushM;
    const rHi = this.frontMaxD > 0 ? Math.min(rHiBase, this.frontMaxD) : rHiBase;
    return { rLo, rHi, minD: this.frontMinD, maxD: this.frontMaxD, frontP, pushM: this.pushM };
  }

  /** ★ 前推（§13.4）：总攻不推；其余每拍 ≤1m、封顶 frontP×120m */
  advancePush(frontP: number, assault: boolean): void {
    if (!assault) this.pushM = Math.min(frontP * 120, this.pushM + 1.0);
  }
  resetPush(): void { this.pushM = 0; }

  /** ★ 环形一日推进（p 驱动，用户定 2026-09-25）：外圈一直收缩；内圈先收→放大（甜甜圈 60）→再收；
   *  总攻（p≥0.80）时已是 (0,0) 一点；形状由 p 驱动；时间轴快进/回退可反向（无棘轮/无总攻锁）。 */
  static ringBounds(p: number, d0min: number, d0max: number): { minD: number; maxD: number } {
    const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
    const BIG_R = 90;      // 大圆半径（第一波）
    const DONUT_IN = 60;   // 甜甜圈内径（小圈峰值）
    const OUT_AT_DONUT = 80; // 甜甜圈段外圈（缓缩后的值；始终 > 内圈）
    const P_ASSAULT = 0.80;
    const pk = Math.max(0, Math.min(1, p));
    let minD: number;
    if (pk < 0.25) minD = d0min;
    else if (pk < 0.45) minD = lerp(d0min, 0, (pk - 0.25) / 0.20);           // 先收缩
    else if (pk < 0.55) minD = lerp(0, DONUT_IN, (pk - 0.45) / 0.10);        // 第一波后立即增大（后撤）
    else if (pk < 0.72) minD = DONUT_IN;
    else if (pk < P_ASSAULT) minD = lerp(DONUT_IN, 0, (pk - 0.72) / (P_ASSAULT - 0.72));
    else minD = 0;
    let maxD: number;
    if (pk < 0.25) maxD = d0max;
    else if (pk < 0.45) maxD = lerp(d0max, BIG_R, (pk - 0.25) / 0.20);
    else if (pk < 0.72) maxD = lerp(BIG_R, OUT_AT_DONUT, (pk - 0.45) / 0.27);
    else if (pk < P_ASSAULT) maxD = lerp(OUT_AT_DONUT, 0, (pk - 0.72) / (P_ASSAULT - 0.72));
    else maxD = 0;
    return { minD, maxD };
  }

  /** ★ 环更新（1Hz；范围按秒更新，不随帧抖动）；夹环基准=舰船 */
  tick(dt: number, p: number, shipX: number, shipZ: number): void {
    this.ringClock += dt;
    if (this.ringClock < 1) return;
    this.ringClock = 0;
    if (!this.plan) return;
    const front0 = { x: this.plan.cx + this.plan.approachX * 40, z: this.plan.cz + this.plan.approachZ * 40 };
    const ffrontD = Math.hypot(shipX - front0.x, shipZ - front0.z);
    const RING_HALF = 80;   // 初始宽环：以原前沿 ffrontD 为中心 ±80m
    const rb = PlanData.ringBounds(p, Math.max(0, ffrontD - RING_HALF), ffrontD + RING_HALF);
    this.frontMinD = rb.minD;
    this.frontMaxD = rb.maxD;
    this.sx = shipX; this.sz = shipZ;   // 夹环/工事基准（单源）
  }

  /** ★ 环形夹取（队长核 port.clampRing）：径向夹进 [下限,上限]；收拢态 → 上限主导 */
  clampToRing(x: number, z: number): { x: number; z: number } {
    if (this.frontMinD < 0 || this.frontMaxD < 0) return { x, z };
    if (this.sx === 0 && this.sz === 0) return { x, z };
    const dx = x - this.sx, dz = z - this.sz;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return { x, z };
    const rMin = this.frontMinD, rMax = this.frontMaxD;
    const rWant = rMax < rMin ? Math.min(d, Math.max(0, rMax)) : Math.min(Math.max(d, rMin), rMax);
    if (Math.abs(rWant - d) <= 0.01) return { x, z };
    this.clamps++;
    return { x: this.sx + (dx / d) * rWant, z: this.sz + (dz / d) * rWant };
  }

  /** ★ 防区锁：队长在环带内 → 目标夹进本扇区楔形；带外 → 原样 */
  sectorLockTarget(x: number, z: number, leaderOf: (id: number) => { x: number; z: number } | null, id: number): { x: number; z: number } {
    const lead = leaderOf(id);
    if (!lead) return { x, z };
    const d = Math.hypot(lead.x - this.sx, lead.z - this.sz);
    if (d < this.frontMinD - 6 || d > this.frontMaxD + 6) return { x, z };   // 外面 → 无约束
    const ang = angleOfPoint(x, z, this.sx, this.sz);
    const ca = clampAngleToSector(ang, secOfPoint(lead.x, lead.z, this.sx, this.sz));
    if (ca === ang) return { x, z };
    const r = Math.hypot(x - this.sx, z - this.sz);
    return { x: this.sx + Math.cos(ca) * r, z: this.sz + Math.sin(ca) * r };
  }

  reset(): void {
    this.plan = null;
    this.stage = 'S0';
    this.pushM = 0;
    this.frontMinD = -1;
    this.frontMaxD = -1;
    this.ringClock = 1;
  }
}
