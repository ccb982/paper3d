// ============================================================
// entity/base/Abilities —— 能力规范化（重写 P1；铁律 10）
// ============================================================
// 四能力统一接口（爬坡 / 爬掩体 / 脱困 / 计时销毁），**L2 代理与 L3 实体同内核**：
//   · 实体只调 request() / tick()，按返回的 AbilityIntent 应用移动与表现；
//   · 状态机（进度 / 超时 / 完成判定）只在本文件，实体不各写各的；
//   · 爬坡：沿坡面梯度**定速直推**、免立面阻挡、跳过人群分离、到顶/超时退出（坡面不驻留）。
// 依赖：entity/TerrainAssist（同层）；不依赖 systems/。
// ============================================================

import type { AbilityId, AbilityRequest } from './contracts';
import { CLIMB_PATH_MS, CLIMB_SPEED_MUL } from '../TerrainAssist';

/** 爬坡单次续期（实秒；与 TerrainAssist.CLIMB_PATH_MS 同源） */
export const CLIMB_TIMEOUT_S = CLIMB_PATH_MS / 1000;

export interface AbilityInput {
  /** 实秒（能力/物理计时——不走 GAME_MIN） */
  now: number;
  x: number;
  z: number;
  /** 目标点 */
  tx: number;
  tz: number;
  /** 到点半径（米） */
  arriveR: number;
  /** 坡面梯度方向（爬坡用；null = 无梯度） */
  slope: { x: number; z: number } | null;
}

export interface AbilityIntent {
  /** 移动方向（单位向量）；null = 本拍不动 */
  dir: { x: number; z: number } | null;
  /** 速度倍率 */
  speedMul: number;
  /** 免立面阻挡（爬坡） */
  ignoreWalls: boolean;
  /** 跳过人群分离（爬坡） */
  skipSeparation: boolean;
  pose: 'normal' | 'crouch' | 'climb';
  done: boolean;
  why: 'arrived' | 'timeout' | 'cancelled' | 'noSlope' | 'none';
}

const IDLE: AbilityIntent = {
  dir: null, speedMul: 1, ignoreWalls: false, skipSeparation: false,
  pose: 'normal', done: false, why: 'none',
};

export class AbilityRunner {
  private cur: (AbilityRequest & { t0: number }) | null = null;
  readonly dbg = { active: '' as '' | AbilityId, runs: 0, done: 0, timeouts: 0, last: '' };

  get active(): AbilityId | null {
    return this.cur?.id ?? null;
  }

  request(req: AbilityRequest, now: number): void {
    this.cur = { ...req, t0: now };
    this.dbg.active = req.id;
    this.dbg.runs++;
  }

  cancel(): void {
    this.cur = null;
    this.dbg.active = '';
  }

  /** 推进当前能力；无能力 → null（走常规移动）。返回 done=true 的 intent 表示本拍结束能力 */
  tick(inp: AbilityInput): AbilityIntent | null {
    const c = this.cur;
    if (!c) return null;
    const el = inp.now - c.t0;
    const dx = inp.tx - inp.x;
    const dz = inp.tz - inp.z;
    const d = Math.hypot(dx, dz);
    const arrived = d <= inp.arriveR;
    const done = (why: AbilityIntent['why']): AbilityIntent => {
      this.cur = null;
      this.dbg.active = '';
      this.dbg.done++;
      this.dbg.last = `${c.id}:${why}@${el.toFixed(1)}s`;
      return { ...IDLE, done: true, why };
    };
    switch (c.id) {
      case 'climb': {
        // 到顶（到点）或梯度消失 → 结束；否则沿梯度定速直推
        if (arrived) return done('arrived');
        const g = inp.slope;
        const len = g ? Math.hypot(g.x, g.z) : 0;
        if (!g || len < 1e-3) return done('noSlope');
        if (el >= c.timeout) {
          this.dbg.timeouts++;
          return done('timeout');
        }
        return {
          dir: { x: g.x / len, z: g.z / len },
          speedMul: CLIMB_SPEED_MUL, ignoreWalls: true, skipSeparation: true,
          pose: 'climb', done: false, why: 'none',
        };
      }
      case 'cover': {
        if (arrived) return done('arrived');
        if (el >= c.timeout) {
          this.dbg.timeouts++;
          return done('timeout');
        }
        if (d < 1e-3) return done('arrived');
        return {
          dir: { x: dx / d, z: dz / d },
          speedMul: 1, ignoreWalls: false, skipSeparation: false,
          pose: 'normal', done: false, why: 'none',
        };
      }
      case 'unstuck': {
        if (arrived) return done('arrived');
        if (el >= c.timeout) {
          this.dbg.timeouts++;
          return done('timeout');
        }
        if (d < 1e-3) return done('none');
        return {
          dir: { x: dx / d, z: dz / d },
          speedMul: 1, ignoreWalls: false, skipSeparation: false,
          pose: 'normal', done: false, why: 'none',
        };
      }
      case 'despawn': {
        if (el >= c.timeout) {
          this.dbg.timeouts++;
          return done('timeout');
        }
        return { ...IDLE };
      }
    }
  }
}
