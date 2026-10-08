/**
 * sensors.ts —— M1 感知模块
 *
 * 职责：每物理步把执行层的原始状态整理成控制层要用的"传感器读数"。
 * **零控制逻辑**（不写任何力矩/目标），只读。
 *
 * 读数清单（对齐 §3.2）：
 *   · com / comVel      —— 全身质心与速度（Body 质量加权）
 *   · feet[].fz / CoP   —— 单脚法向合力与压力中心（接触冲量加权 + 低通）
 *   · support           —— both / l / r / none（按着地阈值滞回前的瞬时判据）
 *   · torsoTilt         —— 躯干（最上脊柱段）相对竖直的 pitch/roll
 *   · torsoAngVel       —— 躯干角速度（世界系）
 *
 * 注意：所有接触量必须在 world.step() 之后读（物理循环里由控制层在下一步开头调用）。
 */

import type { World } from './world';
import { qRotateVec, type Quat } from './quat';

export interface FootSense {
  side: 'l' | 'r';
  /** 法向合力（N，向上为正） */
  fz: number;
  /** 压力中心（世界 x，m） */
  copX: number;
  /** 压力中心（世界 z，m） */
  copZ: number;
  /** 本步是否有有效接触 */
  copValid: boolean;
  /** 是否视为着地（fz ≥ 阈值） */
  loaded: boolean;
  /** 脚掌刚体位置（世界，m）——触地/离地事件用 */
  x: number;
  y: number;
  z: number;
}

export interface SensorsOptions {
  /** 单脚"着地"法向力阈值（N） */
  loadThreshold: number;
  /** CoP 一阶低通系数（0..1；1 = 不过滤） */
  copAlpha: number;
}

export const DEFAULT_SENSORS_OPTIONS: SensorsOptions = {
  loadThreshold: 40,
  copAlpha: 0.5,
};

export class Sensors {
  readonly opt: SensorsOptions;
  readonly com = new Float64Array(3);
  readonly comVel = new Float64Array(3);
  readonly feet: FootSense[];
  support: 'both' | 'l' | 'r' | 'none' = 'none';
  /** 躯干相对竖直：out[0]=pitch（前后），out[1]=roll（左右） */
  readonly torsoTilt = new Float64Array(2);
  readonly torsoAngVel = new Float64Array(3);

  private readonly copTmp = new Float64Array(3);
  private readonly up = new Float64Array(3);
  private readonly upQuat: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private readonly torsoIdx: number;
  private readonly footIdx: { l: number; r: number };

  constructor(
    private readonly world: World,
    opt: Partial<SensorsOptions> = {},
  ) {
    this.opt = { ...DEFAULT_SENSORS_OPTIONS, ...opt };
    this.feet = [
      { side: 'l', fz: 0, copX: 0, copZ: 0, copValid: false, loaded: false, x: 0, y: 0, z: 0 },
      { side: 'r', fz: 0, copX: 0, copZ: 0, copValid: false, loaded: false, x: 0, y: 0, z: 0 },
    ];
    const body = world.body;
    this.torsoIdx = body.indexByKey.get('spine4') ?? body.indexByKey.get('spine3') ?? 0;
    this.footIdx = {
      l: body.indexByKey.get('foot_l') ?? -1,
      r: body.indexByKey.get('foot_r') ?? -1,
    };
  }

  /** 每物理步调用（在 Propose/Decide 之前） */
  update(dt: number): this {
    const body = this.world.body;
    body.com(this.com);
    body.comVel(this.comVel);

    for (const f of this.feet) {
      const ok = body.footCoP(f.side, dt, this.copTmp);
      if (ok) {
        if (!f.copValid) {
          f.copX = this.copTmp[0]!;
          f.copZ = this.copTmp[1]!;
        } else {
          f.copX += (this.copTmp[0]! - f.copX) * this.opt.copAlpha;
          f.copZ += (this.copTmp[1]! - f.copZ) * this.opt.copAlpha;
        }
      }
      f.copValid = ok;
      f.fz = this.copTmp[2]!;
      f.loaded = f.fz >= this.opt.loadThreshold;
      const fi = this.footIdx[f.side];
      if (fi >= 0) {
        const ft = body.bodies[fi]!.translation();
        f.x = ft.x; f.y = ft.y; f.z = ft.z;
      }
    }
    const l = this.feet[0]!.loaded;
    const r = this.feet[1]!.loaded;
    this.support = l && r ? 'both' : l ? 'l' : r ? 'r' : 'none';

    // 躯干姿态（世界 up 向量 → pitch/roll）
    const rb = body.bodies[this.torsoIdx]!;
    const q = rb.rotation();
    this.upQuat.x = q.x; this.upQuat.y = q.y; this.upQuat.z = q.z; this.upQuat.w = q.w;
    qRotateVec(this.upQuat, 0, 1, 0, this.up);
    this.torsoTilt[0] = Math.atan2(this.up[0]!, this.up[1]!);
    this.torsoTilt[1] = Math.atan2(this.up[2]!, this.up[1]!);
    const w = rb.angvel();
    this.torsoAngVel[0] = w.x; this.torsoAngVel[1] = w.y; this.torsoAngVel[2] = w.z;
    return this;
  }

  /** 接触力的总和（N） */
  totalFz(): number {
    return this.feet[0]!.fz + this.feet[1]!.fz;
  }
}
