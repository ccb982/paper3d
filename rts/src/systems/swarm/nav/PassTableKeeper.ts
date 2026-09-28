// ============================================================
// swarm/nav/PassTableKeeper —— 可行性表"随地形走"（用户定 2026-09-27）
// ============================================================
// 背景（《移动执行重写.md》§7.4）：表是路线**唯一权威**（命令门/长寻路/L2 都吃它）。
// 挖掘/地形改动后若表不更新 → 表说能走、移动层（live 地形）拒绝 → 死锁站死。
// 口径：`markDirty()` 标脏（noteTerrainDig 调），0.5s 拍 `flush()` 重建（与工事拍同频）。
// ============================================================

import type { RasterMap } from '../../../services/map/RasterMap';
import type { PassTable } from './PassTable';

export class PassTableKeeper {
  private cx = 0;
  private cz = 0;
  private r = 80;
  private dirty = false;

  /** 落地建表时绑定区域（与 planDefense 的建表参数同源） */
  bind(cx: number, cz: number, r: number): void {
    this.cx = cx; this.cz = cz; this.r = r;
  }

  /** 地形改动标脏（noteTerrainDig 单入口调） */
  markDirty(): void {
    this.dirty = true;
  }

  /** 0.5s 拍：脏 → 重建（表对象原地更新，nav/命令门无需重接） */
  flush(table: PassTable, raster: RasterMap | null): void {
    if (!this.dirty || !raster) return;
    table.build(raster, this.cx, this.cz, this.r);
    this.dirty = false;
  }
}
