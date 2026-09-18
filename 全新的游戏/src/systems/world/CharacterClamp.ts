// ============================================================
// CharacterClamp —— 角色贴地 / 悬停 / 掉坑结算（《实体架构.md》§9.5 模式层下沉）
// ============================================================
// 从 WorldMode 搬出（行为零变化）：
//   · 死亡冻结 / 空中悬停（airborne + 个体相位浮动）/ 真实跳跃不钉地形
//   · 普通贴地（上行限速 7.5 / 下行 25）/ 坑洞判死（玩家 killed + 敌人掉坑减半血）
//   · 敌人掉坑幸存 → 放回坑沿最近可站点（relocateFromPit）
// 玩家载具贴地桥接（clampVehicle）仍由 WorldMode 提供（载具是玩法特例）。
// ============================================================

import type { CharacterBase } from '../../entity/CharacterBase';
import type { RasterMap } from '../../services/map/RasterMap';
import { eventBus } from '../../core/EventBus';
import { AIR_BOB_AMP, AIR_BOB_RATE } from '../swarm/AgentPool';

export interface CharacterClampDeps {
  raster: RasterMap;
  /** 玩家引用（掉坑死亡补 killed / 载具分支判定用） */
  player: CharacterBase;
  /** 玩家载具贴地桥接（WorldMode.clampVehicle；多采样抬高 + 限速） */
  clampVehicle(dt: number): void;
  /** 停靠舰船甲板顶面高度（ShipEntity.deckTopAt；null = 不在甲板范围/航行期） */
  shipDeckTop?(x: number, z: number): number | null;
}

export class CharacterClamp {
  constructor(private readonly deps: CharacterClampDeps) {}

  update(e: CharacterBase, dt: number): void {
    // ★ 死亡等待复活：冻结在死亡地点（不贴地/不重复判死），复活时统一传送回出生点
    if (e.dead) return;
    // ★ 空中层（2026-09-18）：飞行单位**悬停** —— y = 地表高 + airAltitude（+ 个体相位浮动）。
    //   不走贴地/掉坑分支（飞在空中不该被判掉坑），也不受地形落差影响。
    //   ★ 地表取样必须与 L2 代理（SwarmBatch 的 groundAt）同口径 → 都用 surfaceHeightAtFor(x,z,y)，
    //     否则升/降格瞬间会"跳一下"。
    if (e.airborne) {
      const p = e.position;
      const gy = this.deps.raster.surfaceHeightAtFor(p.x, p.z, p.y);
      const bob = Math.sin(performance.now() / 1000 * AIR_BOB_RATE + e.airPhase) * AIR_BOB_AMP;
      const targetY = gy + Math.max(0.4, e.airAltitude) + bob;
      const dy = targetY - p.y;
      // 上下都用限速逼近（爬升 3m/s / 下降 3m/s）：跨地形时不瞬移、不"贴脸闪现"
      p.y += dy > 0 ? Math.min(dy, 3 * dt) : Math.max(dy, -3 * dt);
      return;
    }
    // ★ 空中态不钉地形：真实跳跃（空格）让 y 由 CharacterBase 的抛物线结算，
    //   落地瞬间再回落贴地；否则会把跳起来的角色钉回地面、无法跃过 0.5 高差。
    if (e.controller.isAirborne()) return;
    if (e === this.deps.player && (this.deps.player as { rideVehicle?: boolean }).rideVehicle) {
      this.deps.clampVehicle(dt);
      return;
    }
    const p = e.position;
    const raster = this.deps.raster;
    // ★ 第二层高度（浮空洞顶）：在山上走站洞顶、进洞后站洞底（surfaceHeightAtFor）
    let targetY = raster.surfaceHeightAtFor(p.x, p.z, p.y);
    // ★ 停靠舰船甲板：脚底已接近甲板面（≥ 甲板 - 1.6m）→ 以甲板为地面；
    //   否则保持地形（防止船下/远处角色被抬穿船体）
    const deck = this.deps.shipDeckTop?.(p.x, p.z) ?? null;
    if (deck !== null && deck > targetY && p.y >= deck - 1.6) targetY = deck;
    // ★ 脚下地块复核（2026-09-05 用户实测：补丁把普通地块挖到 <−1.5 也被当深坑判死）：
    //   死亡只属于"坑洞地块的足够深位置"——地面低于 −1.5 只是触发条件之一，还须
    //   所在 4m 地块是坑洞（genRole==='pit'）。普通地块被挖深的补丁坑：正常贴地站立
    //   （不沉落、不判死）；天然坑洞：维持沉落死亡。
    //   ★ 2026-09-10 水里连射被误判掉坑：isDepression 同时覆盖坑洞与水（Tiles.ts），
    //   子弹会把水底挖到 −1.5 以下 → 判死传送。水不是坑洞 → 死亡门槛只认 pit。
    const onPitTile = raster.tileDefAt(p.x, p.z).genRole === 'pit';
    if (targetY >= -1.5 || !onPitTile) {
      const dy = targetY - p.y;
      if (dy > 0) p.y += Math.min(dy, 7.5 * dt);
      else p.y += Math.max(dy, -25 * dt);
      return;
    }
    p.y += Math.max(targetY - p.y, -25 * dt);
    if (p.y <= targetY + 0.05) {
      if (e === this.deps.player) {
        // ★ 玩家掉坑死亡：补发 killed 事件 → 计入遗物"每次死亡"统计（meta.deaths）
        //   （血量归零路径经由 onTakeDamage 自发 killed；掉坑是环境死亡，需手动补发）
        eventBus.emit('killed', { target: e, source: null });
        e.onDeath(null);
      } else {
        // ★ 敌人掉坑减半血（2026-09-14 用户定调）：按最大生命 50% 直接扣血（不吃防御/闪避）；
        //   扣死 → onTakeDamage 自发 killed（掉落/统计走统一管线并移除）；
        //   存活 → 放回坑沿最近可站点，防永久卡坑底
        e.onTakeDamage(Math.max(1, Math.round(e.maxHp * 0.5)), null);
        if (e.hp > 0) this.relocateFromPit(e);
      }
      // 玩家：不在此处传送——镜头留在死亡地点，复活时统一回出生点（PlayerPipeline）
    }
  }

  /** ★ 敌人掉坑幸存：放回坑沿最近可站点（8 向 × 1.5~8m 搜索；
   *  找不到落点（大坑/孤岛）→ 补刀结算，不留卡坑单位） */
  private relocateFromPit(e: CharacterBase): void {
    const p = e.position;
    const raster = this.deps.raster;
    for (let r = 1.5; r <= 8; r += 0.75) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        const td = raster.tileDefAt(x, z);
        if (td.genRole === 'pit' || td.genRole === 'liquid') continue;
        const y = raster.surfaceHeightAt(x, z);
        if (y < -1.2) continue;
        p.x = x;
        p.z = z;
        p.y = y;
        return;
      }
    }
    e.onTakeDamage(e.hp, null); // 无处可放 → 补刀（killed 由 onTakeDamage 统一发）
  }
}
