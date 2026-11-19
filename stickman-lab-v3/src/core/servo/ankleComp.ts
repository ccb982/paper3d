/**
 * AnkleComp —— 脚/踝唯一局部写手。
 * 输入：脚世界目标 + 小腿世界/局部 + 当前踝角。
 * 当前阶段：先保持脚局部角，不接 PD；未接线。
 */
import type { World } from '../world';
import type { FootWorldTarget } from './footWorldTarget';

export interface AnkleTargets {
  qRef: Float64Array;
  kp: Float64Array;
  kd: Float64Array;
}

type Q = { x: number; y: number; z: number; w: number };
const qMul = (a: Q, b: Q): Q => ({
  x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
  y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
  z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
  w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z,
});
const qConj = (q: Q): Q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qToRot = (q: Q): [number, number, number] => {
  const n = Math.hypot(q.x, q.y, q.z);
  if (n < 1e-9) return [0, 0, 0];
  const ang = 2 * Math.atan2(n, q.w);
  return [q.x / n * ang, q.y / n * ang, q.z / n * ang];
};

export class AnkleComp {
  private readonly qRef: Float64Array;
  private readonly kp: Float64Array;
  private readonly kd: Float64Array;
  private captured = false;

  constructor(n: number) {
    this.qRef = new Float64Array(n);
    this.kp = new Float64Array(n);
    this.kd = new Float64Array(n);
  }

  reset(): void {
    this.captured = false;
    this.qRef.fill(0);
    this.kp.fill(0);
    this.kd.fill(0);
  }

  step(w: World, foot: FootWorldTarget): AnkleTargets {
    const body = w.body;
    foot.capture(w);
    if (!this.captured) {
      for (const side of ['l', 'r'] as const) {
        for (const ax of [0, 1, 2] as const) {
          const i = body.dofByName(`foot_${side}`, ax);
          if (i < 0) continue;
          this.qRef[i] = body.dofs[i]!.angle;
          this.kp[i] = ax === 1 ? 20 : 80;
          this.kd[i] = ax === 1 ? 5 : 10;
        }
      }
      this.captured = true;
    }
    for (const side of ['l', 'r'] as const) {
      const target = foot.pose.get(side);
      const si = body.indexByKey.get(`shin_${side}`);
      const fi = body.indexByKey.get(`foot_${side}`);
      if (!target || si === undefined || fi === undefined) continue;
      const qShank = body.bodies[si]!.rotation() as Q;
      const qFoot = body.bodies[fi]!.rotation() as Q;
      const qRelTarget = qMul(qConj(qShank), target.q as Q);
      const qRelNow = qMul(qConj(qShank), qFoot);
      const qErr = qMul(qConj(qRelNow), qRelTarget);
      const [ex, ey, ez] = qToRot(qErr);
      for (const [ax, e] of [[0, ex], [1, ey], [2, ez]] as const) {
        const i = body.dofByName(`foot_${side}`, ax);
        if (i < 0) continue;
        this.qRef[i] = body.dofs[i]!.angle + Math.max(-0.25, Math.min(0.25, 0.5 * e));
      }
    }
    return { qRef: this.qRef, kp: this.kp, kd: this.kd };
  }
}
