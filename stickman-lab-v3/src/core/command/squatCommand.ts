import type { LowerBodyCommand, LowerBodyContext, LowerBodyOutput } from './lowerBody';
import type { ControlModule } from '../control';
import type { CourtState } from '../court';
import { squatFrame } from '../servo/squat';
import { PROPOSALS } from '../proposalBus';
import { advanceStage, createFrameCommand, patchJoint } from './frameCommand';
import { solveFullTsid } from '../servo/fullTsid';
import { evalFootContactTask } from '../servo/footContactTask';
import { sampleFootContact } from '../servo/footContact';

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
  private readonly fullTsidCache = new WeakMap<object, { t: number; out: ReturnType<typeof solveFullTsid> }>();

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
      const SQUAT_WRITERS = new Set([
        'squat.upperBase', 'squat.upperRighting', 'squat.spinePair', 'squat.hip0', 'squat.hip1', 'squat.hip1.passive', 'squat.hip2', 'squat.knee2',
        'squat.knee0', 'squat.knee1', 'squat.foot2.cop', 'squat.foot2.base', 'lowerCommand.ankleSupport', 'lowerCommand.ankleComp', 'lowerCommand.footRecover',
      ]);
      const shadow = createFrameCommand(ctx.world.body.dofs);
      const antiG = new Map<number, number>();
      const best = new Map<string, (typeof PROPOSALS)[number]>();
      for (const p of PROPOSALS) {
        const d = ctx.world.body.dofs[p.dof];
        if (!d || !/^(hip|knee|foot|ankle)_/.test(d.name) || !SQUAT_WRITERS.has(p.src)) continue;
        if (p.kind === 'antiG') { antiG.set(p.dof, (antiG.get(p.dof) ?? 0) + (p.tau ?? 0)); continue; }
        const key = `${p.dof}|${p.kind}|${p.channel ?? 'default'}`;
        const cur = best.get(key);
        if (!cur || p.pri >= cur.pri) best.set(key, p);
      }
      for (const p of best.values()) {
        const d = ctx.world.body.dofs[p.dof]!;
        if (p.kind === 'angle') patchJoint(shadow, p.dof, { qRef: p.rad ?? d.angle, kp: p.kp ?? 0, kd: p.kd ?? 0, hasAngle: true });
        else if (p.kind === 'ext') {
          const c = shadow.joints[p.dof]!;
          if (p.channel === 'passive') c.passive += p.tau ?? 0;
          else if (p.channel === 'external') { c.external += p.tau ?? 0; c.externalCap = Math.max(c.externalCap, p.cap ?? 0); }
          else c.tau += p.tau ?? 0;
        } else if (p.kind === 'torque') shadow.joints[p.dof]!.driveTau += p.tau ?? 0;
      }
      for (const [dof, tau] of antiG) if (/^(hip|knee|foot|ankle)_/.test(ctx.world.body.dofs[dof]?.name ?? '') && shadow.joints[dof]!.driveTau === 0) shadow.joints[dof]!.gravityTau += tau;
      advanceStage(shadow, 3);
      (globalThis as { __SQC_SQUAT_FRAME?: unknown }).__SQC_SQUAT_FRAME = shadow;
      if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FULL_TSID ?? '0') === '1') {
        const hz = Math.max(1, Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FULL_TSID_HZ ?? 10)));
        const cached = this.fullTsidCache.get(ctx.world);
        if (cached && ctx.world.clock - cached.t < 1 / hz) {
          (globalThis as { __SQC_FULL_TSID?: unknown }).__SQC_FULL_TSID = cached.out;
        } else {
        const contacts = (['l', 'r'] as const).map((side) => {
          const bi = ctx.world.body.indexByKey.get(`foot_${side}`)!;
          const rb = ctx.world.body.bodies[bi]!;
          const p = rb.translation();
          const fc = sampleFootContact(ctx.world, side);
          return { body: bi, x: p.x, y: p.y, z: p.z, fx: 0, fy: fc.fzFiltered, fz: 0, tx: 0, ty: 0, tz: 0, halfX: 0.12, halfZ: 0.06, mu: 0.7, fzMin: 0 };
        });
        const accDes = (['l', 'r'] as const).map((side) => {
          const bi = ctx.world.body.indexByKey.get(`foot_${side}`)!;
          const rb = ctx.world.body.bodies[bi]!;
          const target = ctl.footAnkle.world.pose.get(side);
          const fc = sampleFootContact(ctx.world, side);
          const p = rb.translation(), q = rb.rotation(), v = rb.linvel(), av = rb.angvel();
          return evalFootContactTask({
            contact: fc.contact, copInside: fc.copInside, fz: fc.fzFiltered, fzMin: 5,
            targetP: target?.p ?? { x: p.x, y: p.y, z: p.z }, targetQ: target?.q ?? q,
            actualP: { x: p.x, y: p.y, z: p.z }, actualQ: q,
            linVel: { x: v.x, y: v.y, z: v.z }, angVel: { x: av.x, y: av.y, z: av.z },
            posMargin: 0.02, rotMargin: 0.12, linVelMargin: 0.2, angVelMargin: 1.5,
          }).accDes;
        });
        const out = solveFullTsid({ w: ctx.world, contacts, contactAccDes: accDes, wDes: contacts.flatMap((c) => [0, c.fy, 0, 0, 0, 0]) });
        this.fullTsidCache.set(ctx.world, { t: ctx.world.clock, out });
        (globalThis as { __SQC_FULL_TSID?: unknown }).__SQC_FULL_TSID = out;
        }
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
