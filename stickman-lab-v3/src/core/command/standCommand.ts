import type { LowerBodyCommand, LowerBodyContext, LowerBodyOutput } from './lowerBody';
import { baseTq } from '../servo/baseTable';
import { standLegTorque } from './standLegSupport';
import { beginSupportCapture, endSupportCapture } from '../servo/supportClean';

export class StandCommand implements LowerBodyCommand {
  readonly id = 'stand' as const;
  private readonly qRef: Float64Array;
  private readonly tauGravity: Float64Array;
  private readonly ff: Float64Array;
  private output: LowerBodyOutput | null = null;

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
      if (!/^(spine|neck)_/.test(d.name)) continue;
      this.qRef[i] = ctx.upperOnly ? d.angle : 0;
      this.tauGravity[i] = ctx.upperOnly ? 0 : baseTq(d.name, d.axis);
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
    const waistK = Number(env.V3_LOWER_WAIST_DIR ?? 0);
    for (let i = 0; i < body.dofs.length; i++) {
      const d = body.dofs[i]!;
      if (/^(spine|neck)_/.test(d.name)) {
        if (!ctx.upperOnly && waistK !== 0) {
          if (d.axis === 0) this.ff[i] += 0.30 * waistK * (midZ - comZ);
          if (d.axis === 2) this.ff[i] += 0.30 * waistK * (midX - comX);
        }
      }
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
      support: ctx.world.perception.support,
      mode: this.id,
    };
    return this.output;
  }
}
