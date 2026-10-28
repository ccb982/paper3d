/** 蹲姿 CoM 监控器：只估计，不写关节。
 *  蹲姿下盘稳，所以阈值小、反应快；输出总 CoP 请求 + 每脚可用预算。 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';

export interface SquatComFootBudget {
  side: 'l' | 'r';
  fz: number;
  copZ: number;
  copMin: number;
  copMax: number;
  center: number;
  request: number;
  rel: number;
}

export interface SquatComReading {
  comZ: number;
  targetZ: number;
  offset: number;
  vel: number;
  acc: number;
  xcom: number;
  predicted: number;
  copTotal: number;
  level: 0 | 1 | 2;
  feet: [SquatComFootBudget, SquatComFootBudget];
}

export class SquatComMonitor {
  private level: 0 | 1 | 2 = 0;
  private center: { l: number | null; r: number | null } = { l: null, r: null };
  private sum = { l: 0, r: 0 };
  private n = { l: 0, r: 0 };
  private centerStart = -1;

  reset(): void { this.level = 0; this.center = { l: null, r: null }; this.sum = { l: 0, r: 0 }; this.n = { l: 0, r: 0 }; this.centerStart = -1; }

  step(w: World, ctl: ControlModule, st: CS): SquatComReading {
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const li = w.body.indexByKey.get('foot_l');
    const ri = w.body.indexByKey.get('foot_r');
    const zL = li !== undefined ? w.body.bodies[li]!.translation().z : 0;
    const zR = ri !== undefined ? w.body.bodies[ri]!.translation().z : 0;
    const targetZ = (zL + zR) * 0.5;
    const comZ = ctl.sensors.com[2]!;
    const vel = ctl.sensors.comVel[2]!;
    const acc = Number.isFinite(ctl.perception.comAcc[2]!) ? ctl.perception.comAcc[2]! : 0;
    const T = Math.max(0, Math.min(0.2, Number(env.SQC_COM_T ?? 0.1)));
    const offset = comZ - targetZ;
    const predicted = offset + vel * T + 0.5 * acc * T * T;
    const xcom = offset + vel / Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!));
    const inner = Math.abs(Number(env.SQC_COM_INNER ?? 0.004));
    const outer = Math.abs(Number(env.SQC_COM_OUTER ?? 0.012));
    const mag = Math.abs(predicted);
    if (this.level === 0 && mag >= outer) this.level = 2;
    else if (this.level === 2 && mag <= inner * 0.7) this.level = 0;
    else if (this.level === 0 && mag >= inner) this.level = 1;
    else if (this.level === 1 && mag <= inner * 0.5) this.level = 0;
    const lim = Math.abs(Number(env.SQC_COM_COP_LIMIT ?? 0.08));
    const copTotal = Math.max(targetZ - lim, Math.min(targetZ + lim, targetZ + predicted));
    const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
    const pfl = ctl.perception.feet[0]!, pfr = ctl.perception.feet[1]!;
    const half = Math.abs(Number(env.SQC_COM_FOOT_HALF ?? 0.02));
    // 释放后先取稳态 CoP 平均，不能用第一帧
    if (st.released) {
      if (this.centerStart < 0) this.centerStart = st.t;
      const avgT = Math.abs(Number(env.SQC_COM_CENTER_AVG ?? 0.15));
      if (st.t - this.centerStart >= avgT) {
        if (this.center.l === null && this.n.l > 0) this.center.l = this.sum.l / this.n.l;
        if (this.center.r === null && this.n.r > 0) this.center.r = this.sum.r / this.n.r;
      } else {
        if (fl.copValid) { this.sum.l += fl.copZ; this.n.l++; }
        if (fr.copValid) { this.sum.r += fr.copZ; this.n.r++; }
      }
    }
    const centerL = this.center.l ?? fl.copZ;
    const centerR = this.center.r ?? fr.copZ;
    const bounds = [
      { side: 'l' as const, z: centerL, lo: centerL - half, hi: centerL + half, fz: fl.fz, slip: pfl.slip },
      { side: 'r' as const, z: centerR, lo: centerR - half, hi: centerR + half, fz: fr.fz, slip: pfr.slip },
    ];
    // 每脚目标是“脚中心 + 总偏移”，不是把总 CoP 绝对值塞进每只脚；
    // 双脚对称时 predicted=0 → request 就是脚中心。
    const delta = copTotal - targetZ;
    const req = [
      Math.max(bounds[0]!.lo, Math.min(bounds[0]!.hi, centerL + delta)),
      Math.max(bounds[1]!.lo, Math.min(bounds[1]!.hi, centerR + delta)),
    ];
    const W = Math.max(1e-6, fl.fz + fr.fz);
    const wgt = [fl.fz / W, fr.fz / W];
    let err = copTotal - (wgt[0]! * req[0]! + wgt[1]! * req[1]!);
    for (let iter = 0; iter < 4 && Math.abs(err) > 1e-9; iter++) {
      const dir = err > 0 ? 1 : -1;
      const room = [
        dir > 0 ? bounds[0]!.hi - req[0]! : req[0]! - bounds[0]!.lo,
        dir > 0 ? bounds[1]!.hi - req[1]! : req[1]! - bounds[1]!.lo,
      ];
      const denom = Math.max(1e-9, wgt[0]! * Math.max(0, room[0]!) + wgt[1]! * Math.max(0, room[1]!));
      const use = Math.max(-1, Math.min(1, err / denom));
      for (let i = 0; i < 2; i++) {
        if (bounds[i]!.slip) continue;
        req[i] = Math.max(bounds[i]!.lo, Math.min(bounds[i]!.hi, req[i]! + use * Math.min(Math.abs(err), Math.max(0, room[i]!))));
      }
      err = copTotal - (wgt[0]! * req[0]! + wgt[1]! * req[1]!);
    }
    const feet: [SquatComFootBudget, SquatComFootBudget] = [
      { side: 'l', fz: fl.fz, copZ: fl.copZ, copMin: bounds[0]!.lo, copMax: bounds[0]!.hi, center: centerL, request: req[0]!, rel: req[0]! - centerL },
      { side: 'r', fz: fr.fz, copZ: fr.copZ, copMin: bounds[1]!.lo, copMax: bounds[1]!.hi, center: centerR, request: req[1]!, rel: req[1]! - centerR },
    ];
    return {
      comZ, targetZ, offset, vel, acc, xcom, predicted, copTotal,
      level: this.level, feet,
    };
  }
}
