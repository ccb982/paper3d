import type { LowerBodyCommand, LowerBodyContext, LowerBodyOutput } from './lowerBody';

const env = (): Record<string, string | undefined> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});
const num = (key: string, def: number): number => {
  const v = Number(env()[key]);
  return Number.isFinite(v) ? v : def;
};

/**
 * 蹲姿命令层：只持有捕获姿态，不直接写执行器。
 * 交接时捕获一次 qRef，之后由同一个 PD 执行器保持。
 */
export class SquatCommand implements LowerBodyCommand {
  readonly id = 'squat' as const;
  private readonly qRef: Float64Array;
  private readonly tauGravity: Float64Array;
  private readonly ff: Float64Array;
  private readonly kp: Float64Array;
  private readonly kd: Float64Array;
  private captured = false;
  private gBuf: Float64Array | null = null;
  private handoffTau: Float64Array | null = null;
  private t = 0;

  constructor(n: number) {
    this.qRef = new Float64Array(n);
    this.tauGravity = new Float64Array(n);
    this.ff = new Float64Array(n);
    this.kp = new Float64Array(n);
    this.kd = new Float64Array(n);
  }

  reset(): void {
    this.captured = false;
    this.qRef.fill(0);
    this.tauGravity.fill(0);
    this.ff.fill(0);
    this.kp.fill(0);
    this.kd.fill(0);
    this.gBuf = null;
    this.handoffTau = null;
    this.t = 0;
  }

  beginFrom(w: LowerBodyContext['world']): void {
    const n = w.body.dofs.length;
    this.handoffTau = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.handoffTau[i] = w.executor.ledger[i]?.applied ?? 0;
      this.qRef[i] = w.body.dofs[i]!.angle;
    }
    this.captured = true;
    this.t = 0;
  }

  step(ctx: LowerBodyContext): LowerBodyOutput {
    const body = ctx.world.body;
    const n = body.dofs.length;
    if (!this.gBuf || this.gBuf.length !== n) this.gBuf = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const d = body.dofs[i]!;
      const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
      if (!this.captured) this.qRef[i] = d.angle;
      this.kp[i] = (0.5 * d.tauMax) / lim;
      this.kd[i] = num('V3_LOWER_PD_KD', 0.05) * d.tauMax;
      this.ff[i] = 0;
      this.tauGravity[i] = 0;
    }
    this.captured = true;
    this.t += ctx.dt;

    // 交接后先沿用上一命令的实际支撑力矩作为前馈；不在这里重新算一份
    // 不同的支撑模型，否则状态切换首帧必然产生阶跃力。
    for (let i = 0; i < n; i++) this.tauGravity[i] = 0;

    if (this.handoffTau) {
      for (let i = 0; i < n; i++) this.ff[i] = this.handoffTau[i]!;
    }

    return {
      qRef: this.qRef,
      tauGravity: this.tauGravity,
      ff: this.ff,
      support: ctx.world.perception.support,
      mode: this.id,
      kp: this.kp,
      kd: this.kd,
    };
  }
}
