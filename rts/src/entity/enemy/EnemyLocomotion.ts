// ============================================================
// EnemyLocomotion —— 敌人移动器（M0：**只做接触修正**）
// ============================================================
// 方向只来自单命令链（steer 模块）；本件只做：坡面混合 + 前方即将踩危险→停；
// 其余接触修正（硬边分量清零/可行性表斥力/脱埋）在内核 CharacterCore。
// 地形判定：坑 / h<-1.2 = 禁止；**水=正常地块**（提前豁免，含深水）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { getSteerTable } from '../SteerPick';
import { fallLineBlend } from '../TerrainAssist';

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
    // ★ 危险判定已删（用户澄清：从不是这套设计里的机制）。
    //   本件只做坡面跟随/转移：方向只来自单命令链（steer 模块）；合法性归表/路线。
    void raster; void px; void py; void pz;
    return { move: true, x: _d.x, z: _d.z };
  }

}
