/**
 * FootContactLayer —— 常驻脚/踝写手。
 * 只提交 foot0/1/2 的角度目标；不写 executor，不写外部力。
 */
import type { World } from '../world';
import { PRI, propose } from '../proposalBus';

export class FootContactLayer {
  private q0 = new Float64Array(0);
  private captured = false;

  constructor(private readonly w: World) {}

  reset(): void {
    this.captured = false;
  }

  step(): void {
    const body = this.w.body;
    if (!this.captured) {
      this.q0 = new Float64Array(body.dofs.length);
      for (const side of ['l', 'r'] as const) {
        for (const ax of [0, 1, 2] as const) {
          const i = body.dofByName(`foot_${side}`, ax);
          if (i < 0) continue;
          this.q0[i] = body.dofs[i]!.angle;
        }
      }
      this.captured = true;
    }
    for (const side of ['l', 'r'] as const) {
      for (const ax of [0, 1, 2] as const) {
        const i = body.dofByName(`foot_${side}`, ax);
        if (i < 0) continue;
        const kp = ax === 1 ? 20 : 80;
        const kd = ax === 1 ? 5 : 10;
        propose({ dof: i, kind: 'angle', pri: PRI.action, rad: this.q0[i]!, kp, kd, src: 'lowerCommand.footContact' });
      }
    }
  }
}
