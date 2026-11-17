import type { LowerBodyCommand, LowerBodyContext, LowerBodyOutput } from './lowerBody';
import { baseTq, baseAng } from '../servo/baseTable';
import { planStandBalance } from './standBalance';
import { standLegTorque } from './standLegSupport';
import { beginSupportCapture, endSupportCapture } from '../servo/supportClean';

const useBase = (): boolean => String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.V3_LOWER_BASE ?? '0') !== '0';

export class StandCommand implements LowerBodyCommand {
  readonly id = 'stand' as const;
  private readonly qRef: Float64Array;
  private readonly tauGravity: Float64Array;
  private readonly ff: Float64Array;
  private output: LowerBodyOutput | null = null;
  private refX: number | null = null;
  private refZ: number | null = null;

  constructor(n: number) {
    this.qRef = new Float64Array(n);
    this.tauGravity = new Float64Array(n);
    this.ff = new Float64Array(n);
  }

  reset(): void {
    this.qRef.fill(0);
    this.tauGravity.fill(0);
    this.ff.fill(0);
    this.output = null;
    this.refX = null;
    this.refZ = null;
  }

  step(ctx: LowerBodyContext): LowerBodyOutput {
    const body = ctx.world.body;
    for (let i = 0; i < body.dofs.length; i++) {
      this.qRef[i] = body.dofs[i]!.angle;
      this.ff[i] = 0;
    }
    body.gravityComp(this.tauGravity, -9.81);
    for (let i = 0; i < body.dofs.length; i++) {
      const d = body.dofs[i]!;
      if (/^(spine|neck)_/.test(d.name)) {
        this.qRef[i] = ctx.upperOnly ? d.angle : 0;
        this.tauGravity[i] = ctx.upperOnly ? 0 : baseTq(d.name, d.axis);
        continue;
      }
      if (!/^(hip|knee|foot|ankle)_/.test(d.name)) continue;
      const a = baseAng(d.name, d.axis);
      if (Number.isFinite(a)) this.qRef[i] = a!;
      const mirror = d.axis === 0 && d.name.endsWith('_l') ? -1 : 1;
      this.tauGravity[i] = mirror * baseTq(d.name, d.axis);
    }
    if (false) {
      for (let i = 0; i < body.dofs.length; i++) {
        const d = body.dofs[i]!;
        if (/^(hip|knee|foot|ankle)_/.test(d.name)) this.tauGravity[i] = baseTq(d.name, d.axis);
      }
    }
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const li = body.indexByKey.get('foot_l') ?? -1;
    const ri = body.indexByKey.get('foot_r') ?? -1;
    const lp = li >= 0 ? body.bodies[li]!.translation() : { x: 0, z: 0 };
    const rp = ri >= 0 ? body.bodies[ri]!.translation() : { x: 0, z: 0 };
    const midX = (lp.x + rp.x) / 2;
    const midZ = (lp.z + rp.z) / 2;
    const comX = ctx.sensors.com[0] ?? 0;
    const comZ = ctx.sensors.com[2] ?? 0;
    const wx = Math.sqrt(9.81 / Math.max(0.3, ctx.sensors.com[1] ?? 0.8));
    const xcomX = comX + (ctx.sensors.comVel[0] ?? 0) / wx;
    const xcomZ = comZ + (ctx.sensors.comVel[2] ?? 0) / wx;
    const Kdir = Number(env.V3_LOWER_DIR_K ?? 2500);
    const copSag = (ctx.world.perception.feet[0]?.copX ?? 0);
    const waistK = Number(env.V3_LOWER_WAIST_DIR ?? 0);
    for (let i = 0; i < body.dofs.length; i++) {
      const d = body.dofs[i]!;
      if (/^(spine|neck)_/.test(d.name)) {
        if (!ctx.upperOnly && waistK !== 0) {
          if (d.axis === 0) this.ff[i] += 0.30 * waistK * (midZ - comZ);
          if (d.axis === 2) this.ff[i] += 0.30 * waistK * (midX - comX);
        }
        continue;
      }
      if (!/^(hip|knee|foot)_/.test(d.name)) continue;
      const w = d.name.startsWith('hip') ? 0.45 : d.name.startsWith('knee') ? 0.15 : 0.10;
      const sgn = d.axis === 0 && d.name.endsWith('_l') ? -1 : 1;
      if (d.axis === 0) this.ff[i] += sgn * w * Kdir * (midZ - comZ);
      if (d.axis === 2) this.ff[i] += w * Kdir * (midX - comX);
      if (d.name.startsWith('foot') && d.axis === 2) this.ff[i] += 250 * (xcomX - copSag);
    }
    if (this.refX === null) this.refX = ctx.sensors.com[0] ?? 0;
    if (this.refZ === null) this.refZ = ctx.sensors.com[2] ?? 0;
    const eX = this.refX - (ctx.sensors.com[0] ?? 0);
    const eZ = this.refZ - (ctx.sensors.com[2] ?? 0);
    const vX = ctx.sensors.comVel[0] ?? 0;
    const vZ = ctx.sensors.comVel[2] ?? 0;
    const kpX = Number(env.V3_LOWER_ANKLE_KP ?? 2.0);
    const kdX = Number(env.V3_LOWER_ANKLE_KD ?? 0.2);
    const kpZ = Number(env.V3_LOWER_ANKLE_KPZ ?? 2.0);
    const kdZ = Number(env.V3_LOWER_ANKLE_KDZ ?? 0.2);
    const cap = Number(env.V3_LOWER_ANKLE_CAP ?? 0.12);
    const supK = Number(env.V3_LOWER_SUPPORT_K ?? 0);
    const supSign = Number(env.V3_LOWER_SUPPORT_SIGN ?? 1);
    const supCap = Number(env.V3_LOWER_SUPPORT_CAP ?? 80);
    const fzNow = (ctx.sensors.feet[0]?.fz ?? 0) + (ctx.sensors.feet[1]?.fz ?? 0);
    const supportTau = supK === 0 ? 0 : Math.max(-supCap, Math.min(supCap, supSign * supK * ((ctx.world.sk.massTotal * 9.81) - fzNow) / Math.max(1, ctx.world.sk.massTotal * 9.81)));
    for (let i = 0; i < body.dofs.length; i++) {
      const dd = body.dofs[i]!;
      if (/^knee_/.test(dd.name) && dd.axis === 2) this.ff[i] = supportTau;
    }
    const bal = planStandBalance(ctx, this.refX, this.refZ);
    const copSign = Number(env.V3_LOWER_COP_SIGN ?? 1);
    const copCap = Number(env.V3_LOWER_COP_CAP ?? 80);
    for (const side of ['l', 'r'] as const) {
      const i2 = body.dofByName(`foot_${side}`, 2);
      const i0 = body.dofByName(`foot_${side}`, 0);
      if (i2 < 0 || i0 < 0) continue;
      const fz = side === 'l' ? bal.fzLRef : bal.fzRRef;
      const ax = body.dofs[i2]!.anchorWorld[0]!;
      const az = body.dofs[i0]!.anchorWorld[2]!;
      this.ff[i2] = Math.max(-copCap, Math.min(copCap, copSign * fz * (bal.pRefX - ax)));
      this.ff[i0] = Math.max(-copCap, Math.min(copCap, copSign * fz * (bal.pRefZ - az)));
    }
    const aX = Math.max(-cap, Math.min(cap, kpX * eX + kdX * vX));
    const aZ = Math.max(-cap, Math.min(cap, kpZ * eZ + kdZ * vZ));
    for (const side of ['l', 'r'] as const) {
      const i2 = body.dofByName(`foot_${side}`, 2);
      const i0 = body.dofByName(`foot_${side}`, 0);
      if (i2 >= 0) this.qRef[i2] = body.dofs[i2]!.angle + aX;
      if (i0 >= 0) this.qRef[i0] = body.dofs[i0]!.angle + aZ;
    }
    const legTau = new Float64Array(body.dofs.length);
    const supportCap = beginSupportCapture();
    ctx.supportClean?.('r');
    ctx.supportClean?.('l');
    endSupportCapture();
    for (const [i, t] of supportCap) legTau[i] = t;
    if (supportCap.size === 0) standLegTorque(ctx, legTau);
    const sagDamp = Number(env.V3_LOWER_SAG_DAMP ?? 50);
    if (sagDamp !== 0) {
      const vX = ctx.sensors.comVel[0] ?? 0;
      for (let i = 0; i < body.dofs.length; i++) {
        const d = body.dofs[i]!;
        if (d.axis === 2 && /^(hip|knee|foot)_/.test(d.name)) legTau[i] = legTau[i]! - sagDamp * vX;
      }
    }
    for (let i = 0; i < body.dofs.length; i++) {
      const d = body.dofs[i]!;
      if (!/^(hip|knee|foot|ankle)_/.test(d.name)) continue;
      this.qRef[i] = d.angle;
      this.tauGravity[i] = 0;
      this.ff[i] = legTau[i]!;
    }
    this.output = {
      qRef: this.qRef,
      tauGravity: this.tauGravity,
      ff: this.ff,
      support: bal.support,
      copRef: { x: bal.pRefX, z: bal.pRefZ },
      mode: this.id,
    };
    return this.output;
  }
}
