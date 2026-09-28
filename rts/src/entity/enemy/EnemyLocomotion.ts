// ============================================================
// EnemyLocomotion —— 敌人移动器（M0：**只做接触修正**）
// ============================================================
// 方向只来自单命令链（steer 模块）；本件只做：坡面混合 + 前方即将踩危险→停；
// 其余接触修正（硬边分量清零/可行性表斥力/脱埋）在内核 CharacterCore。
// 地形判定：坑 / h<-1.2 = 禁止；**水=正常地块**（提前豁免，含深水）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { getSteerTable } from '../SteerPick';
import { fallLineBlend, dangerPointAt } from '../TerrainAssist';

/** 地形辅助 scratch（零分配） */
const _d = { x: 0, z: 0 };

/** 本帧移动解析结果（move=false → 本帧不动） */
export interface LocomotionResult {
  move: boolean;
  x: number;
  z: number;
}

export class EnemyLocomotion {
  /** 危险探测距离（米；> 碰撞半宽，提前一个身位避开坑沿） */
  /** 探针：最近一次实际期望方向（诊断用） */
  private lastDesiredX = 0;
  private lastDesiredZ = 0;
  /** 陡坡判定：1.2m 内升 > 1.0m（≈40°）= 墙 */

  /**
   * 解析本帧移动方向（候选选择：禁向量合成）。
   * @param px,py,pz 当前位置（py 用于第二层高度/洞顶选层）
   * @param airborne 空中单位豁免地面危险
   */
  resolve(px: number, py: number, pz: number, airborne: boolean, dx: number, dz: number, dt: number): LocomotionResult {
    void dt;
    if (airborne) return { move: true, x: dx, z: dz };
    const raster = RasterMap.current;
    // ★ 爬山（共享基础方法 TerrainAssist；与 L2 代理同内核）：坡正面（水=正常地块，无特殊）
    const tbl = getSteerTable();
    fallLineBlend(tbl, px, pz, dx, dz, _d);
    this.lastDesiredX = _d.x; this.lastDesiredZ = _d.z;
    const danger = (x: number, z: number): boolean => this.isDangerPoint(raster, x, z, px, pz, py);
    const inside = danger(px, pz);
    // ★ M0（用户定 2026-09-27）：方向只来自单命令链（steer 模块）；
    //   本件只做**接触修正**：前方即将踩危险（坑/过低/立面）→ 停；
    //   其余交内核（分量清零/可行性表斥力/坡面 weld）。
    // ★ M0（用户定 2026-09-27）：方向只来自单命令链（steer 模块）；
    //   本件只做**接触修正**：前方即将踩危险（坑/过低/立面）→ 停；
    //   其余交内核（分量清零/可行性表斥力/坡面 weld）。
    if (!inside && (_d.x !== 0 || _d.z !== 0) && danger(px + _d.x * 1.2, pz + _d.z * 1.2)) {
      return { move: false, x: 0, z: 0 };
    }
    return { move: true, x: _d.x, z: _d.z };
  }

  /** ★ 点危险判定：坑 / 过低 / 立面（非坡硬边 > 台阶）——共享内核 `dangerPointAt` */
  private isDangerPoint(
    raster: RasterMap | null, x: number, z: number,
    px: number, pz: number, py: number,
  ): boolean {
    return raster ? dangerPointAt(raster, x, z, px, pz, py) : false;
  }
}
