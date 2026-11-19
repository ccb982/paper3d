/**
 * DynamicSupport —— 唯一动态基础力命令源（未接线）。
 *
 * 输入：supportWbc 的 Fz/腿支撑力矩
 * 输出：qRef/kp/kd/ff
 * 不写 executor、不写脚。
 */
import type { World } from '../world';
import type { Sensors } from '../sensors';
import { computeSupportWbc } from '../servo/supportWbc';

export interface DynamicSupportOutput {
  qRef: Float64Array;
  kp: Float64Array;
  kd: Float64Array;
  ff: Float64Array;
}

export class DynamicSupport {
  private readonly qRef: Float64Array;
  private readonly kp: Float64Array;
  private readonly kd: Float64Array;
  private readonly ff: Float64Array;

  constructor(n: number) {
    this.qRef = new Float64Array(n);
    this.kp = new Float64Array(n);
    this.kd = new Float64Array(n);
    this.ff = new Float64Array(n);
  }

  reset(): void {
    this.qRef.fill(0);
    this.kp.fill(0);
    this.kd.fill(0);
    this.ff.fill(0);
  }

  step(w: World, s: Sensors): DynamicSupportOutput {
    for (let i = 0; i < w.body.dofs.length; i++) {
      const d = w.body.dofs[i]!;
      this.qRef[i] = d.angle;
      this.kp[i] = 0;
      this.kd[i] = 0;
      this.ff[i] = 0;
    }
    const sup = computeSupportWbc(w, s);
    const set = (n: string, ax: number, ff: number): void => {
      const i = w.body.dofByName(n, ax);
      if (i < 0) return;
      this.ff[i] = ff;
      this.kp[i] = 50;
      this.kd[i] = 2;
    };
    set('hip_l', 2, sup.hipL);
    set('hip_r', 2, sup.hipR);
    set('knee_l', 2, sup.kneeL);
    set('knee_r', 2, sup.kneeR);
    set('foot_l', 2, sup.ankleL);
    set('foot_r', 2, sup.ankleR);
    return { qRef: this.qRef, kp: this.kp, kd: this.kd, ff: this.ff };
  }
}
