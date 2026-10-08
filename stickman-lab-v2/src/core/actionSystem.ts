/**
 * actionSystem.ts —— 动作层（独立的动作提案系统）
 *
 * 用户定调：按钮这些塞进**动作层**（另一个系统）；执行动作时**伺服层默默工作**
 * （控制模块照常跑预警/反射/基建，只把动作的目标整合进去）。
 *
 * 本系统只产出"动作提案"：
 *   · `poseTargets()` —— 需要接管的关节目标（世界按 dof 索引）
 *   · `comTarget()`   —— 动作的质心轨道（重心转移相位）
 * 由控制模块整合后发布关节命令（本模块不直接写执行层）。
 *
 * 动作两类：
 *   · 关键帧动作（鞠躬/蹬地）：本模块内部插值（smoothstep）
 *   · 相位动作（单腿）：交给 ProgramRunner（事件驱动相位）
 */

import type { World } from './world';
import type { Sensors } from './sensors';
import type { StabilityWarner } from './stability';
import type { Keyframe } from './manual';
import { ProgramRunner } from './program';
import { BOW, PUSH_RISE, singleLegPhases, evalComTrack, type ActionScript } from './actions';

export type ActionId = 'stand' | 'bow' | 'singleLegR' | 'pushRise';

export class ActionSystem {
  readonly runner: ProgramRunner;
  readonly status: { id: ActionId | null; t: number; phase: string | null; active: boolean } = {
    id: null, t: 0, phase: null, active: false,
  };
  private script: ActionScript | null = null;
  private frames: Keyframe[] | null = null;
  private framesT = 0;
  private playing = false;
  private readonly pose = new Map<number, { rad: number; kp: number }>();
  private readonly torque = new Map<number, number>();
  private readonly com = { x: 0, z: 0 };

  constructor(
    private readonly world: World,
    private readonly warner: StabilityWarner,
    sensors: Sensors,
  ) {
    this.runner = new ProgramRunner({ sensors, bal: warner, body: world.body });
  }

  /** 播放动作（stand = 停手回站姿） */
  play(id: ActionId): void {
    this.runner.stop();
    this.frames = null;
    this.script = null;
    this.playing = false;
    this.framesT = 0;
    this.status.id = id;
    this.status.t = 0;
    this.status.phase = null;
    this.status.active = true;

    if (id === 'stand') { this.status.active = false; return; }
    if (id === 'singleLegR') {
      this.runner.play(singleLegPhases('r', 1.2));
      return;
    }
    const script = id === 'bow' ? BOW : PUSH_RISE;
    this.frames = script.frames;
    this.script = script;
    this.playing = true;
  }

  abort(): void {
    this.runner.stop();
    this.frames = null;
    this.script = null;
    this.playing = false;
    this.status.id = null;
    this.status.active = false;
  }

  /** 每步推进（由控制模块调用；此时算好 poseTargets/comTarget 供整合） */
  step(dt: number): void {
    this.pose.clear();
    this.torque.clear();
    this.com.x = 0;
    this.com.z = 0;

    if (this.status.active) this.status.t += dt;
    if (this.status.id === 'singleLegR') {
      this.runner.step(dt);
      const cur = this.runner.current;
      this.status.phase = cur ? cur.name : null;
      this.status.active = this.runner.active;
      return;
    }
    if (!this.playing || !this.frames) return;

    this.framesT += dt;
    const frames = this.frames;
    const last = frames[frames.length - 1]!;
    if (this.framesT >= last.t) {
      this.applyFrame(last);
      if (this.script?.comTrack) {
        const c = evalComTrack(this.script.comTrack, this.framesT);
        this.com.x = c.x; this.com.z = c.z;
      }
      this.playing = false;
      return;
    }
    // 找到当前帧对
    let k = 0;
    while (k < frames.length - 1 && frames[k + 1]!.t < this.framesT) k++;
    const a = frames[k]!, b = frames[k + 1]!;
    const u = b.t > a.t ? (this.framesT - a.t) / (b.t - a.t) : 0;
    const s = u * u * (3 - 2 * u);
    const keys = new Set([...Object.keys(a.pose ?? {}), ...Object.keys(b.pose ?? {})]);
    for (const key of keys) {
      const [name, axStr] = key.split('/');
      const di = this.world.body.dofByName(name!, Number(axStr));
      if (di < 0) continue;
      const va = a.pose?.[key] ?? 0;
      const vb = b.pose?.[key] ?? 0;
      this.pose.set(di, { rad: va + (vb - va) * s, kp: 0 });
    }
    // ★ 力矩关键帧（蹬地挺腰用）：线性插值，经控制模块写入 Executor
    const tkeys = new Set([...Object.keys(a.torque ?? {}), ...Object.keys(b.torque ?? {})]);
    for (const key of tkeys) {
      const [name, axStr] = key.split('/');
      const di = this.world.body.dofByName(name!, Number(axStr));
      if (di < 0) continue;
      const va = a.torque?.[key] ?? 0;
      const vb = b.torque?.[key] ?? 0;
      this.torque.set(di, va + (vb - va) * s);
    }
    if (this.script?.comTrack) {
      const c = evalComTrack(this.script.comTrack, this.framesT);
      this.com.x = c.x; this.com.z = c.z;
    }
  }

  private applyFrame(f: Keyframe): void {
    for (const [key, v] of Object.entries(f.pose ?? {})) {
      const [name, axStr] = key.split('/');
      const di = this.world.body.dofByName(name!, Number(axStr));
      if (di >= 0) this.pose.set(di, { rad: v, kp: 0 });
    }
    for (const [key, v] of Object.entries(f.torque ?? {})) {
      const [name, axStr] = key.split('/');
      const di = this.world.body.dofByName(name!, Number(axStr));
      if (di >= 0) this.torque.set(di, v);
    }
  }

  /** 本步要接管的关节目标（供控制模块整合） */
  poseTargets(): Map<number, { rad: number; kp: number }> {
    return this.pose;
  }

  /** 本步的附着力矩（供控制模块整合） */
  torqueTargets(): Map<number, number> {
    return this.torque;
  }

  /** 本步的质心轨道（重心转移相位） */
  comTarget(): { x: number; z: number } {
    return this.com;
  }
}
