/**
 * FootAnkleModule —— 站立/蹲下/交接/法庭共用的唯一脚踝模块。
 *
 * 世界：脚体位姿 + 踝世界补偿
 * 局部：不同姿势的踝局部命令
 */
import type { World } from '../world';
import { FootWorldTarget } from './footWorldTarget';
import { AnkleComp } from './ankleComp';
import { computeMuscleDamping } from './muscleDamping';

export interface FootAnkleTargets {
  qRef: Float64Array;
  kp: Float64Array;
  kd: Float64Array;
}

export class FootAnkleModule {
  readonly world = new FootWorldTarget();
  readonly ankle: AnkleComp;
  constructor(n: number) {
    this.ankle = new AnkleComp(n);
  }

  reset(): void {
    this.world.reset();
    this.ankle.reset();
  }

  step(w: World): FootAnkleTargets {
    const t: FootAnkleTargets = this.ankle.step(w, this.world);
    const qdd = ((globalThis as { __ACC_OBS?: Record<string, number> }).__ACC_OBS ?? {}).qddAnkle ?? 0;
    for (const side of ['l', 'r'] as const) {
      const f2 = w.body.dofByName(`foot_${side}`, 2);
      if (f2 < 0) continue;
      const d = w.body.dofs[f2]!;
      const md = computeMuscleDamping({
        mass: Math.max(1e-6, (d as unknown as { inertiaLow?: number }).inertiaLow ?? 0.05),
        wn: 45, zeta: 1.0, amax: 120, c: 0.5, c0: 0.5,
        acc: qdd, accRef: 0, accGain: 0.05, vel: d.vel,
        dGain: 4, tauCap: d.tauMax * 0.5,
        soft: 1, softD: 1, dev: 0,
        srsFrac: 1.0, srsYield: 0.06, eccGain: 1.2, conGain: 0.2, vRef: 2,
      });
      t.kp[f2] = Math.max(t.kp[f2] ?? 0, md.kp, 800);
      t.kd[f2] = Math.max(t.kd[f2] ?? 0, md.kd, 80);
    }
    return t;
  }
}
