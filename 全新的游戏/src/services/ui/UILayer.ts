// ============================================================
// UILayer —— UI 层统一入口（架构：HUD 与小地图同属展示层）
// ============================================================
// ★ 解耦：WorldMode 不直接持有/绘制任何 UI——只持有一个 UILayer，
//   左上角小地图 + 玩家血量 HUD 都在这一层内创建/更新/销毁。
//   后续 UI（弹药/技能/结算）继续挂进本层，模式层零改动。

import { RasterMap } from '../map/RasterMap';
import { Minimap } from './Minimap';
import { PlayerHud } from './PlayerHud';

export class UILayer {
  private minimap: Minimap;
  private hud: PlayerHud;

  constructor(raster: RasterMap) {
    this.minimap = new Minimap(raster);
    this.hud = new PlayerHud();
  }

  /** 每帧驱动（模式层调用；数据全由参数传入，UI 层不持有实体） */
  update(
    px: number,
    pz: number,
    playerYaw: number,
    entities: import('../../entity/EntityBase').EntityBase[],
    hp: number,
    maxHp: number,
  ): void {
    this.minimap.update(px, pz, playerYaw, entities);
    this.hud.update(hp, maxHp);
  }

  dispose(): void {
    this.minimap.dispose();
    this.hud.dispose();
  }
}
