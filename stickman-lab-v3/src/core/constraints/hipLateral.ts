import type { World } from '../world';
import type { Sensors } from '../sensors';
import { baseState } from '../servo/baseTable';

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

/**
 * 髋/骨盆侧向移动限位。
 * - 只在 squat 状态工作；
 * - 捕获进入 squat 时的骨盆横向 z；
 * - 超过 ±range 时在 project 里硬夹回，并把 z 速度清零（强制钉死）；
 * - 当前默认开启（SQC_HIP_LATERAL=1）；=0 关闭。
 */
export class HipLateralConstraint {
  readonly id = 'hip-lateral';
  readonly priority = 20;
  private ref = 0;
  private init = false;

  reset(): void {
    this.ref = 0;
    this.init = false;
  }

  step(w: World, _sensors: Sensors, _dt: number): void {
    const active = baseState() === 'squat' || (globalThis as { __SQC_SQUAT_DOWN?: boolean }).__SQC_SQUAT_DOWN === true;
    if (num('SQC_HIP_LATERAL', 1) !== 1 || !active) {
      this.reset();
      return;
    }
    if (this.init) return;
    const ti = w.body.indexByKey.get('torso');
    if (ti === undefined) return;
    this.ref = w.body.bodies[ti]!.translation().z;
    this.init = true;
  }

  project(w: World): void {
    const active = baseState() === 'squat' || (globalThis as { __SQC_SQUAT_DOWN?: boolean }).__SQC_SQUAT_DOWN === true;
    if (!this.init || !active) return;
    const ti = w.body.indexByKey.get('torso');
    if (ti === undefined) return;
    const rb = w.body.bodies[ti]!;
    const p = rb.translation();
    const down = (globalThis as { __SQC_SQUAT_DOWN?: boolean }).__SQC_SQUAT_DOWN === true;
    const range = Math.abs(down ? num('SQC_HIP_LATERAL_DOWN_RANGE', 0.003) : num('SQC_HIP_LATERAL_RANGE', 0.04));
    const lo = this.ref - range;
    const hi = this.ref + range;
    const z = Math.max(lo, Math.min(hi, p.z));
    if (z === p.z) return;
    rb.setTranslation({ x: p.x, y: p.y, z }, true);
    const v = rb.linvel();
    rb.setLinvel({ x: v.x, y: v.y, z: 0 }, true);
  }
}
