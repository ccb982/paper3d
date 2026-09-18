// ============================================================
// WaterFx —— 入水表现系统（《实体架构.md》§9.5 模式层下沉）
// ============================================================
// 从 WorldMode 搬出（行为零变化）：
//   ① 角色入水检测：走进水面 / 从高处落入 / 水中移动 → 水面波动（只对玩家补入水音）
//   ② 涉水循环轨（仅玩家）：水里且真的在移动 → 慢放连续水声；停/出水/非探索 → 淡出
// 调用方：WorldMode 每帧喂 player + enemies（探索期）；进舱/退模式停轨。
// ============================================================

import type { CharacterBase } from '../../entity/CharacterBase';
import type { RasterMap } from '../../services/map/RasterMap';
import { sharedWaterMaterial } from '../../services/map/WaterMaterial';
import { playSfx, playLoopSfx, stopLoopSfx } from '../../services/audio/Sfx';

/** 每角色入水状态记录（复用对象，零 GC） */
interface WaterRec {
  liquid: boolean;
  y: number;
  x: number;
  z: number;
  rippleMs: number;
}

export class WaterFx {
  private prev = new Map<CharacterBase, WaterRec>();
  private wadeLoopOn = false;
  private wadeRate = 1;
  private wadeVol = 0.5;
  private wadePrev = { x: 0, z: 0, valid: false };

  constructor(private readonly raster: RasterMap) {}

  /**
   * ① 角色入水检测：走进水面 / 从高处落入水面 → 该处水面剧烈波动；
   *   在水中持续移动 → 脚下周期性泛波。只触发波动表现，不改角色位置。
   * @param isPlayer 只有玩家入水播 `waterEnter` 音（实体→音效的原有口径）
   */
  entry(e: CharacterBase, dt: number, isPlayer: boolean): void {
    const p = e.position;
    const liquid = this.raster.tileDefAt(p.x, p.z).genRole === 'liquid';
    // ★ 复用记录对象（每帧 set 新对象会制造 GC 压力——60+ 实体每帧一个）
    let rec = this.prev.get(e);
    if (!rec) {
      rec = { liquid, y: p.y, x: p.x, z: p.z, rippleMs: 0 };
      this.prev.set(e, rec);
      return;
    }
    const prevLiquid = rec.liquid;
    const prevY = rec.y;
    const prevX = rec.x;
    const prevZ = rec.z;
    rec.liquid = liquid;
    rec.y = p.y;
    rec.x = p.x;
    rec.z = p.z;
    // 走进水面（方块由非水 → 水，且脚底在水面以下 0.5m 内才算真正入水）
    if (liquid && !prevLiquid && p.y < 0.5) {
      rec.rippleMs = performance.now();
      sharedWaterMaterial.addImpact(p.x, p.z, 0.8);
      if (isPlayer) playSfx('waterEnter', 400);
      return;
    }
    // 高处坠落 / 跳入：本帧穿过 y=0 水面 → 波幅随坠落速度增大
    if (liquid && prevY > 0.08 && p.y <= 0.08) {
      rec.rippleMs = performance.now();
      const vy = Math.max(0, (prevY - p.y) / Math.max(dt, 1e-3));
      sharedWaterMaterial.addImpact(p.x, p.z, Math.min(1.6, 0.7 + vy * 0.15));
      if (isPlayer) playSfx('waterEnter', 400);
      return;
    }
    // ★ 在水中移动 → 脚下周期性泛波（按【实际位移速度】：静止不泛波——载具圆凳悬停时不再高频溅波）
    const movedSpeed = dt > 1e-3 ? Math.hypot(p.x - prevX, p.z - prevZ) / dt : 0;
    if (liquid && movedSpeed > 0.3) {
      const now = performance.now();
      const gap = 340 - Math.min(movedSpeed, 10) * 28; // 慢走 0.3s 一泛，快跑 ~0.2s
      if (now - rec.rippleMs >= gap) {
        rec.rippleMs = now;
        sharedWaterMaterial.addImpact(p.x, p.z, Math.min(0.55, 0.28 + movedSpeed * 0.06));
        // ★ 涉水声不再按节拍点播（0.73s 素材 @330ms = 多层叠着响的糊声）→ 改走
        //   连续循环轨，见 wade（慢放比例每次入水随机）。
      }
    }
  }

  /**
   * ② 涉水循环轨（仅玩家）：在水里且真的在移动 → 一条慢放的连续水声；
   *   停下 / 出水 / 非探索阶段 → 淡出。
   *
   * 为什么是循环轨而不是点播：素材 0.73s，点播再怎么拉间隔都是"一段一段"的；
   *   而游动是持续状态，听感上必须连续。慢放比例每次起轨随机（0.80~0.92），
   *   同一条轨内固定 —— 随机是为了不腻，固定是为了不抖。
   * @param exploreActive 探索期（航行/舰内不裁决，防残留）
   */
  wade(dt: number, exploreActive: boolean, player: CharacterBase): void {
    const on = exploreActive && !player.dead;
    const p = player.position;
    const liquid = on && this.raster.tileDefAt(p.x, p.z).genRole === 'liquid';
    let speed = 0;
    if (this.wadePrev.valid && dt > 1e-3) {
      speed = Math.hypot(p.x - this.wadePrev.x, p.z - this.wadePrev.z) / dt;
    }
    this.wadePrev.x = p.x;
    this.wadePrev.z = p.z;
    this.wadePrev.valid = true;

    if (on && liquid && speed > 0.3) {
      if (!this.wadeLoopOn) {
        this.wadeLoopOn = true;
        // ★ 每次入水随机慢放比例（降速同时降调 → 水里的黏滞感）。
        //   0.80~0.92：再慢（<0.8）会明显发闷，反而听不清。
        this.wadeRate = 0.80 + Math.random() * 0.12;
        // ★ 每次入水随机音量 0.45~0.62（等效 ≈ -21~-24 LUFS，与脚步声 -22.9 同档）。
        //   ★★ 必须缓存在字段里：每帧都调 playLoopSfx，音量若逐帧变化会不停触发淡入淡出。
        this.wadeVol = 0.45 + Math.random() * 0.17;
      }
      playLoopSfx('waterSwim', { rate: this.wadeRate, volume: this.wadeVol });
    } else if (this.wadeLoopOn) {
      this.stopWade();
    }
  }

  /** ★ 停掉涉水循环轨（进舱 / 退模式 / 换局：防止水声残留到别的场景） */
  stopWade(): void {
    this.wadeLoopOn = false;
    this.wadePrev.valid = false;
    stopLoopSfx('waterSwim');
  }

  /** ★ 命中点附近水面剧烈波动（子弹落水；原 WorldMode.agitateWaterNear） */
  agitateNear(x: number, z: number, r = 0.6): void {
    const hit = this.waterPointWithin(x, z, r);
    if (!hit) return;
    sharedWaterMaterial.addImpact(hit.x, hit.z, 1.4);
  }

  /** 命中点及半径 r 的十字采样内找水面；返回最近水面点，无则 null */
  private waterPointWithin(x: number, z: number, r: number): { x: number; z: number } | null {
    if (this.raster.tileDefAt(x, z).genRole === 'liquid') return { x, z };
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (this.raster.tileDefAt(sx, sz).genRole === 'liquid') {
        return { x: sx, z: sz };
      }
    }
    return null;
  }

  /** ★ 跨局清理（退模式）：入水记录 + 涉水轨状态 */
  reset(): void {
    this.prev.clear();
    this.wadePrev.valid = false;
  }
}
