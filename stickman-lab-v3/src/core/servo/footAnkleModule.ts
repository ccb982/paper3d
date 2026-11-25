/**
 * FootAnkleModule —— 站立/蹲下/交接/法庭共用的唯一脚踝模块。
 *
 * 世界：脚体位姿 + 踝世界补偿
 * 局部：不同姿势的踝局部命令
 */
import type { World } from '../world';
import { FootWorldTarget } from './footWorldTarget';
import { AnkleComp } from './ankleComp';

export interface FootAnkleTargets {
  qRef: Float64Array;
  kp: Float64Array;
  kd: Float64Array;
}

export class FootAnkleModule {
  readonly world = new FootWorldTarget();
  readonly ankle: AnkleComp;
  private readonly support = new Map<'l' | 'r', number>();

  constructor(n: number) {
    this.ankle = new AnkleComp(n);
  }

  reset(): void {
    this.world.reset();
    this.ankle.reset();
    this.support.clear();
  }

  setSupportTorque(side: 'l' | 'r', tau: number): void {
    this.support.set(side, Number.isFinite(tau) ? tau : 0);
  }

  clearSupport(): void {
    this.support.clear();
  }

  step(w: World): FootAnkleTargets {
    const t: FootAnkleTargets = this.ankle.step(w, this.world);
    for (const side of ['l', 'r'] as const) {
      const f2 = w.body.dofByName(`foot_${side}`, 2);
      if (f2 >= 0) {
        const kp = Math.max(1, t.kp[f2] ?? 400);
        const q = t.qRef[f2] ?? w.body.dofs[f2]!.angle;
        const off = Math.max(-0.25, Math.min(0.25, (this.support.get(side) ?? 0) / kp));
        t.qRef[f2] = q + off;
      }
    }
    return t;
  }
}
