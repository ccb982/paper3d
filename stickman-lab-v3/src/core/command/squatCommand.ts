import type { LowerBodyCommand, LowerBodyContext, LowerBodyOutput } from './lowerBody';
import type { ControlModule } from '../control';
import type { CourtState } from '../court';
import { squatFrame } from '../servo/squat';

type KernelGlobals = {
  __V3_SQUAT_COURT?: CourtState | null;
  __V3_SQUAT_CTL?: ControlModule | null;
};

/**
 * 蹲姿命令层：把蹲姿法庭的 squatFrame 力链封装成命令实例。
 * 不重写 IK/Fz/逆动力学；PD 执行器不变。
 */
export class SquatCommand implements LowerBodyCommand {
  readonly id = 'squat' as const;
  private readonly qRef: Float64Array;
  private readonly tauGravity: Float64Array;
  private readonly ff: Float64Array;

  constructor(n: number) {
    this.qRef = new Float64Array(n);
    this.tauGravity = new Float64Array(n);
    this.ff = new Float64Array(n);
  }

  reset(): void {
    this.qRef.fill(0);
    this.tauGravity.fill(0);
    this.ff.fill(0);
  }

  step(ctx: LowerBodyContext): LowerBodyOutput {
    const g = globalThis as KernelGlobals;
    const court = g.__V3_SQUAT_COURT ?? null;
    const ctl = g.__V3_SQUAT_CTL ?? null;
    if (court && ctl) {
      squatFrame(ctx.world, ctl, court);
      for (let i = 0; i < this.qRef.length; i++) this.qRef[i] = ctx.world.body.dofs[i]!.angle;
      return {
        qRef: this.qRef,
        tauGravity: this.tauGravity,
        ff: this.ff,
        support: ctx.world.perception.support,
        mode: this.id,
        delegate: true,
      };
    }
    for (let i = 0; i < this.qRef.length; i++) this.qRef[i] = ctx.world.body.dofs[i]!.angle;
    return {
      qRef: this.qRef,
      tauGravity: this.tauGravity,
      ff: this.ff,
      support: ctx.world.perception.support,
      mode: this.id,
      delegate: true,
    };
  }
}
