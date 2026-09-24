// ============================================================
// EnemyLocomotion —— 敌人移动器（E5 组合件；★ 与代理同源：SteerPick 候选选择）
// ============================================================
// 本文件不再"硬转向"：危险地形只作为**硬否决**，方向由 8 向候选 softmax 选出
// （含承诺窗/转向惯性；与代理执行层同一套 `pickSteer`，两载体同内核）。
// 地形判定：坑 / h<-1.2 = 禁止；**水=正常地块**（提前豁免，含深水）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { pickSteer, getSteerTable } from '../SteerPick';
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
  /** ★ 承诺方向/到期（SteerPick 外部状态；与代理同语义） */
  private heldX = 0;
  private heldZ = 0;
  private heldUntil = 0;
  /** 危险探测距离（米；> 碰撞半宽，提前一个身位避开坑沿） */
  private static readonly PROBE = 1.6;
  /** 探针：承诺方向/到期 + 最近一次实际期望方向（诊断用） */
  private lastDesiredX = 0;
  private lastDesiredZ = 0;
  get heldDbg(): { x: number; z: number; until: number; dx: number; dz: number } {
    return { x: this.heldX, z: this.heldZ, until: this.heldUntil, dx: this.lastDesiredX, dz: this.lastDesiredZ };
  }
  /** 陡坡判定：1.2m 内升 > 1.0m（≈40°）= 墙 */
  private static readonly STEEP_RISE = 1.0;

  /**
   * 解析本帧移动方向（候选选择：禁向量合成）。
   * @param px,py,pz 当前位置（py 用于第二层高度/洞顶选层）
   * @param airborne 空中单位豁免地面危险
   */
  resolve(px: number, py: number, pz: number, airborne: boolean, dx: number, dz: number, dt: number): LocomotionResult {
    void dt;
    if (airborne) {
      this.heldX = 0; this.heldZ = 0; this.heldUntil = 0;
      return { move: true, x: dx, z: dz };
    }
    const raster = RasterMap.current;
    // ★ 爬山（共享基础方法 TerrainAssist；与 L2 代理同内核）：坡正面（水=正常地块，无特殊）
    const tbl = getSteerTable();
    fallLineBlend(tbl, px, pz, dx, dz, _d);
    this.lastDesiredX = _d.x; this.lastDesiredZ = _d.z;
    const danger = (x: number, z: number): boolean => this.isDangerPoint(raster, x, z, px, pz, py);
    const inside = danger(px, pz);
    const res = pickSteer(
      px, pz, _d.x, _d.z, 0, 0,
      this.heldX, this.heldZ, this.heldUntil,
      performance.now() / 1000,
      inside, danger, null,
    );
    if (res.hold) return { move: false, x: 0, z: 0 };
    this.heldX = res.x; this.heldZ = res.z; this.heldUntil = res.until;
    return { move: true, x: res.x, z: res.z };
  }

  /** ★ 点危险判定：坑 / 过低 / 立面（非坡硬边 > 台阶）——共享内核 `dangerPointAt` */
  private isDangerPoint(
    raster: RasterMap | null, x: number, z: number,
    px: number, pz: number, py: number,
  ): boolean {
    return raster ? dangerPointAt(raster, x, z, px, pz, py) : false;
  }
}
