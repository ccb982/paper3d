/**
 * 伺服 · 动量工具（只读）——WBAM（全身角动量绕 CoM）+ 节段分解 + 抵消系数 κ。
 *
 * 文献：Herr & Popovic 2008 JEB 211:467（步态全程 WBAM 各轴 ≈0；节段间抵消率
 * M/L 95% / A/P 69% / 纵 77%；κ = 1 − |ΣL|/Σ|L|，0=同向、1=完全抵消）。
 * 用途（`保护预警与反射弧.md` §2.16）：探针/HUD/伺服动量调节器共用；唯一实现。
 *
 * 约定：世界系 x=前、y=上、z=侧；绕 z 的角动量 = 矢状面（俯仰）——抬腿/落腿的问题轴。
 */
import type { Body } from '../body';
import { qMul, qRotateVec, qInvRotateVec, type Quat } from '../quat';

export interface MomentumOut {
  /** 全身角动量（世界系绕 CoM；kg·m²/s） */
  L: { x: number; y: number; z: number };
  /** 归一化 |L| / (M·√(g·h)·h)（Herr 口径） */
  norm: number;
  /** 节段角动量（段名 → 世界系绕 CoM） */
  segs: Map<string, { x: number; y: number; z: number }>;
  /** 抵消系数（每轴） */
  kappa: { x: number; y: number; z: number };
}

const comTmp = new Float64Array(3);
const tmpA = new Float64Array(3);
const tmpB = new Float64Array(3);

export function computeMomentum(body: Body): MomentumOut {
  body.com(comTmp);
  const c0 = comTmp[0]!, c1 = comTmp[1]!, c2 = comTmp[2]!;
  const nameOf = new Map<number, string>();
  for (const [k, i] of body.indexByKey) nameOf.set(i, k);
  const segs = new Map<string, { x: number; y: number; z: number }>();
  let lx = 0, ly = 0, lz = 0, ax = 0, ay = 0, az = 0;
  body.bodies.forEach((b, i) => {
    const m = b.mass();
    if (m <= 0) return;
    const t = b.translation();
    const v = b.linvel();
    const w = b.angvel();
    // 轨道项：(r − r_cm) × (m·v)
    const rx = t.x - c0, ry = t.y - c1, rz = t.z - c2;
    let sx = ry * m * v.z - rz * m * v.y;
    let sy = rz * m * v.x - rx * m * v.z;
    let sz = rx * m * v.y - ry * m * v.x;
    // 自转项：R_eff·(I_local ∘ (R_effᵀ·ω))
    const I = b.principalInertia();
    const qp = b.principalInertiaLocalFrame() as Quat;
    const qe = qMul(b.rotation() as Quat, qp);
    qInvRotateVec(qe, w.x, w.y, w.z, tmpA);
    tmpB[0] = I.x * tmpA[0]!;
    tmpB[1] = I.y * tmpA[1]!;
    tmpB[2] = I.z * tmpA[2]!;
    qRotateVec(qe, tmpB[0]!, tmpB[1]!, tmpB[2]!, tmpA);
    sx += tmpA[0]!; sy += tmpA[1]!; sz += tmpA[2]!;
    segs.set(nameOf.get(i) ?? `#${i}`, { x: sx, y: sy, z: sz });
    lx += sx; ly += sy; lz += sz;
    ax += Math.abs(sx); ay += Math.abs(sy); az += Math.abs(sz);
  });
  const eps = 1e-9;
  const h = Math.max(0.3, c1);
  const norm = Math.hypot(lx, ly, lz) / (body.sk.massTotal * Math.sqrt(9.81 * h) * h);
  return {
    L: { x: lx, y: ly, z: lz },
    norm,
    segs,
    kappa: {
      x: 1 - Math.abs(lx) / Math.max(ax, eps),
      y: 1 - Math.abs(ly) / Math.max(ay, eps),
      z: 1 - Math.abs(lz) / Math.max(az, eps),
    },
  };
}

/** 伺服 · 动量调节器（§2.16）：动作执行期间由控制层自动调用。
 *  读 WBAM 的俯仰分量 Lz，用**手臂反向旋转**抵消（Herr 2008：腿动量由上身平衡；
 *  手臂=自由通道，不与脊柱/腿的动作写手冲突）。 */
export const MOM_REG = {
  /** 手臂反向增益（角目标 rad / (kg·m²/s)） */
  armGain: 0.06,
  /** 手臂角限幅（rad） */
  armCap: 0.7,
  /** Lz 死区（kg·m²/s） */
  dead: 0.5,
  /** 角速限（rad/s） */
  rate: 2,
};

export interface MomRefs {
  bal: { manual: { setAngle(j: string, a: number, r: number, kp?: number, kd?: number): void; clearAngle(j: string, a: number): void } };
  body: Body;
}

export class MomentumReg {
  private a = 0;
  private owned = false;
  step(ctx: MomRefs, dt: number): void {
    this.owned = true;
    const mm = computeMomentum(ctx.body);
    const want = Math.abs(mm.L.z) > MOM_REG.dead
      ? Math.max(-MOM_REG.armCap, Math.min(MOM_REG.armCap, -MOM_REG.armGain * mm.L.z))
      : 0;
    const stp = MOM_REG.rate * dt;
    const d = want - this.a;
    this.a += Math.abs(d) <= stp ? d : Math.sign(d) * stp;
    ctx.bal.manual.setAngle('shoulder_l', 2, this.a, 120, 15);
    ctx.bal.manual.setAngle('shoulder_r', 2, this.a, 120, 15);
  }
  /** 只清自己写过的（转变时一次；每帧清会擦掉空闲手臂/其它写手） */
  release(ctx: MomRefs): void {
    this.a = 0;
    if (!this.owned) return;
    this.owned = false;
    ctx.bal.manual.clearAngle('shoulder_l', 2);
    ctx.bal.manual.clearAngle('shoulder_r', 2);
  }
}
