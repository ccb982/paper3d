// ============================================================
// CoverEntity —— 城墙 / 墙（StructureEntity 子类；《RTS架构.md》§1.3 L2 工件）
// ============================================================
// 形态：高 3m / 宽 4m / 厚 0.8m；灰砖。城墙 = 正面竖向射击孔（宽 0.5 / 高 1.0~1.5）+ 光环；墙 = 实心。
// 碰撞：复合长方体 = 下段 + 上段 + 左右立柱 —— 只有穿过孔带才能命中后方
//       （复用 BodyOptions.extraColliders，与舰船分段同一套基建）。
// 建造：buildProgress 0→1 插值长高（渲染器消费）；施工期可被打断（玩法层控制）。
// 摧毁：走 applyDamage（StructureEntity 覆写，不发 killed / 不计击杀）。
// 来源：敌方杂兵施工（owner='enemy'）/ 玩家道具发射落地（owner='player'）。
// ★ 城墙光环（2026-09-19）：范围内墙体持续修复 + 生命上限（跟随玩家生命）+ 防御。
// ============================================================

import type * as THREE from 'three';
import { StructureEntity, type StructureOptions } from './StructureEntity';
import type { EntityManager } from './EntityManager';
import { addStaticObstacleRect, removeStaticObstacle } from '../services/physics/StaticObstacleRegistry';
import { HealthBar } from '../services/fx/HealthBar';
import { GROUP_WALL, GROUP_COVER_PLAYER, GROUP_SLIT_PLAYER } from '../services/physics/PhysicsWorld';
import { RasterMap } from '../services/map/RasterMap';
import {
  CoverRenderer,
  COVER_W, COVER_H, COVER_T, COVER_SLIT_W, COVER_SLIT_Y0, COVER_SLIT_Y1,
} from '../services/render/CoverRenderer';

/** 城墙/墙生命值（走 applyDamage 口径；可被拆） */
export const COVER_HP = 400;
/** ★ 城墙光环（2026-09-19）：范围内墙体持续修复 + 上限提升（跟随玩家生命）+ 防御加成。
 *  ★ 2026-09-19 二次定调：**多个城墙可叠加**（每座城墙各贡献一份），城墙之间/对墙一视同仁。 */
export const WALL_AURA_R = 10;
/** 每座城墙的上限提升 = 玩家最大生命 × 该比例（多座城墙相加） */
export const WALL_AURA_HP_RATIO = 0.8;
/** 每座城墙的防御加成（多座城墙相加） */
export const WALL_AURA_DEF = 6;
/** 每座城墙的持续修复速度（HP/秒；多座城墙相加） */
export const WALL_AURA_HEAL = 25;
/** ★ 玩家在城墙附近此半径内开枪 → 子弹"无视墙"（防贴墙被自己的墙挡；远距离照常命中） */
export const WALL_IGNORE_R = 4;
/** 玩家部署的默认成型时长（秒；插值长高） */
export const COVER_DEPLOY_BUILD_TIME = 0.6;

export interface CoverOptions {
  x: number; y: number; z: number;
  /** 朝向（弧度；局部 +Z = 墙厚轴/正面法线） */
  heading?: number;
  /** 归属（决定 camp / 通行掩码） */
  owner?: 'player' | 'enemy';
  /** 生命值（缺省 COVER_HP） */
  hp?: number;
  /** 成型时长（秒；0 = 立即成型） */
  buildTime?: number;
  /** ★ 变体：cover = 带射击孔掩体（默认）；wall = 实心墙「土木老姐」（无孔、可攀） */
  variant?: 'cover' | 'wall';
  /** ★ 海报（2026-09-19 用户定调：**玩家造的有海报，敌人造的没有**；缺省 true） */
  poster?: boolean;
}

/** ★ 城墙光环结算（每帧；数量个位数 → O(n²) 可忽略）：
 *  ★ **只作用于玩家墙**（敌人掩体不吃玩家城墙光环，也不提供光环）。
 *  来源 = 玩家城墙（variant 'cover'）；目标 = 玩家墙（含自身/彼此）。
 *  可叠加：范围内每座城墙各贡献一份；离开范围自动回落基础值。 */
export function updateWallAuras(playerMaxHp: number, dt: number): void {
  const all: CoverEntity[] = [];
  for (const c of _coverRegistry) all.push(c);
  const perHp = Math.round(playerMaxHp * WALL_AURA_HP_RATIO);
  const r2 = WALL_AURA_R * WALL_AURA_R;
  for (const w of all) {
    if (w.owner !== 'player') continue;   // ★ 敌人掩体不参与玩家墙光环
    let bh = 0, bd = 0, heal = 0;
    for (const src of all) {
      if (src.owner !== 'player' || src.variant !== 'cover') continue;
      const dx = src.position.x - w.position.x;
      const dz = src.position.z - w.position.z;
      if (dx * dx + dz * dz > r2) continue;
      bh += perHp;
      bd += WALL_AURA_DEF;
      heal += WALL_AURA_HEAL;
    }
    w.applyAura(bh, bd, heal, dt);
  }
}

/** ★ 支撑面（墙上叠墙用）：排除自身，只认"脚下或略高"（≤ belowY+0.6）的墙顶 */
export function coverSupportAt(
  x: number, z: number, belowY: number, exclude: CoverEntity,
): number | null {
  let best: number | null = null;
  for (const c of _coverRegistry) {
    if (c === exclude) continue;
    const top = c.topAt(x, z);
    if (top === null) continue;
    if (top > belowY + 0.6) continue;
    if (best === null || top > best) best = top;
  }
  return best;
}

/** ★ 世界状态持久化：导出墙记录（WorldStateCache 用）。
 *  @param owner 只导出该归属（玩家墙 / 敌人掩体**分开存档**，不混） */
export function snapshotCovers(owner?: 'player' | 'enemy'): import('../core/WorldStateCache').WallRec[] {
  const out: import('../core/WorldStateCache').WallRec[] = [];
  for (const c of _coverRegistry) {
    if (owner !== undefined && c.owner !== owner) continue;
    const p = c.position;
    out.push({
      x: p.x, y: p.y, z: p.z,
      heading: c.heading,
      variant: c.variant,
      hp: c.hp,
      owner: c.owner,
    });
  }
  return out;
}

/** ★ 线段 (ax,az)→(bx,bz) 是否被某座墙挡住（远程选位的"掩体真的挡子弹吗"校验）。
 *  实现：把线段变换到墙局部坐标，与矩形 [-W/2,W/2]×[-T/2,T/2] 做 slab 相交。 */
/** ★ 点是否在掩体脚印内（+margin）——过掩体优化：SteerPick 惩罚 / 绕行判定 */
export function coverAt(x: number, z: number, margin = 0.2): boolean {
  for (const c of _coverRegistry) {
    const p = c.position;
    const fwdX = Math.sin(c.heading), fwdZ = Math.cos(c.heading);   // 厚轴
    const rgtX = fwdZ, rgtZ = -fwdX;                                // 宽轴
    const u = (x - p.x) * rgtX + (z - p.z) * rgtZ;
    const v = (x - p.x) * fwdX + (z - p.z) * fwdZ;
    if (Math.abs(u) <= COVER_W / 2 + margin && Math.abs(v) <= COVER_T / 2 + margin) return true;
  }
  return false;
}

export function coverBlocksLine(ax: number, az: number, bx: number, bz: number): boolean {
  for (const c of _coverRegistry) {
    const p = c.position;
    const fwdX = Math.sin(c.heading), fwdZ = Math.cos(c.heading);   // 厚轴
    const rgtX = fwdZ, rgtZ = -fwdX;                                // 宽轴
    const rel = (x: number, z: number): { u: number; v: number } => ({
      u: (x - p.x) * rgtX + (z - p.z) * rgtZ,   // 宽向
      v: (x - p.x) * fwdX + (z - p.z) * fwdZ,   // 厚向
    });
    const a = rel(ax, az), b = rel(bx, bz);
    const du = b.u - a.u, dv = b.v - a.v;
    const hw = COVER_W / 2, ht = COVER_T / 2;
    let t0 = 0, t1 = 1;
    const clip = (p0: number, d: number, lo: number, hi: number): boolean => {
      if (Math.abs(d) < 1e-6) return p0 >= lo && p0 <= hi;
      let tA = (lo - p0) / d, tB = (hi - p0) / d;
      if (tA > tB) { const tmp = tA; tA = tB; tB = tmp; }
      t0 = Math.max(t0, tA);
      t1 = Math.min(t1, tB);
      return t0 <= t1;
    };
    if (clip(a.u, du, -hw, hw) && clip(a.v, dv, -ht, ht)) return true;
  }
  return false;
}

/** ★ 玩家附近是否有**玩家墙**（开枪时判定"无视自家墙"；敌人墙不享受该便利） */
export function wallNear(x: number, z: number, r = WALL_IGNORE_R): boolean {
  const r2 = r * r;
  for (const c of _coverRegistry) {
    if (c.owner !== 'player') continue;
    const dx = c.position.x - x;
    const dz = c.position.z - z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

/** ★ 掩体注册表（顶面站立 / 攀爬查询用；数量个位数，线性扫描足够） */
const _coverRegistry = new Set<CoverEntity>();

/** ★ 掩体顶面高度（世界 Y；不在任何掩体足迹内 → null）——供角色贴地/落顶 */
export function coverTopAt(x: number, z: number): number | null {
  let best: number | null = null;
  for (const c of _coverRegistry) {
    const top = c.topAt(x, z);
    if (top !== null && (best === null || top > best)) best = top;
  }
  return best;
}

export class CoverEntity extends StructureEntity {
  readonly owner: 'player' | 'enemy';
  /** ★ 变体（城墙 = 带射击孔+光环；墙 = 实心） */
  readonly variant: 'cover' | 'wall';
  /** 是否带射击孔（wall = false：整面实心） */
  private readonly hasSlit: boolean;
  private readonly buildTime: number;
  private buildElapsed = 0;
  /** ★ 角色阻挡索引 id（JS 静态障碍：掩体挡人走，不挡弹——弹走物理复合体） */
  private readonly blockId: number;
  /** 墙朝向（碰撞体/阻挡索引/渲染共用） */
  readonly heading: number;
  /** ★ 光环前的基础值（城墙光环动态改 maxHp/defense，离开范围要能回落） */
  private readonly baseMaxHp: number;
  private readonly baseDefense: number;
  /** ★ 海报开关（玩家造 = true；敌人造 = false） */
  private readonly poster: boolean;

  constructor(em: EntityManager, scene: THREE.Scene, opts: CoverOptions) {
    const hasSlit = (opts.variant ?? 'cover') !== 'wall';
    // ★ 碰撞分组（2026-09-19 用户定调）：玩家造 → GROUP_COVER_PLAYER（玩家/友军子弹穿自家）；
    //   敌人造 → GROUP_WALL（敌弹穿自家）；对方子弹一律实心（只能穿射击孔）。
    const groups = opts.owner === 'player'
      ? (GROUP_COVER_PLAYER << 16) | 0xffff
      : (GROUP_WALL << 16) | 0xffff;
    // ★ 物理（2026-09-19 三次定调）：城墙 = **带射击孔的复合体**
    //   （下沿 / 上沿 / 左右立柱；子弹可从孔穿过）；墙（无孔）= 实心单盒。
    const phys: StructureOptions['physics'] = hasSlit
      ? {
          type: 'fixed',
          options: {
            shape: { type: 'cuboid', hx: COVER_W / 2, hy: COVER_SLIT_Y0 / 2, hz: COVER_T / 2 },
            shapeOffset: { x: 0, y: COVER_SLIT_Y0 / 2, z: 0 },
            extraColliders: [
              {
                shape: { type: 'cuboid', hx: COVER_W / 2, hy: (COVER_H - COVER_SLIT_Y1) / 2, hz: COVER_T / 2 },
                offset: { x: 0, y: (COVER_SLIT_Y1 + COVER_H) / 2, z: 0 },
              },
              {
                shape: { type: 'cuboid', hx: (COVER_W - COVER_SLIT_W) / 4, hy: (COVER_SLIT_Y1 - COVER_SLIT_Y0) / 2, hz: COVER_T / 2 },
                offset: { x: -(COVER_W + COVER_SLIT_W) / 4, y: (COVER_SLIT_Y0 + COVER_SLIT_Y1) / 2, z: 0 },
              },
              {
                shape: { type: 'cuboid', hx: (COVER_W - COVER_SLIT_W) / 4, hy: (COVER_SLIT_Y1 - COVER_SLIT_Y0) / 2, hz: COVER_T / 2 },
                offset: { x: (COVER_W + COVER_SLIT_W) / 4, y: (COVER_SLIT_Y0 + COVER_SLIT_Y1) / 2, z: 0 },
              },
              // ★ 我方射击孔膜（2026-09-19）：玩家造城墙的孔口贴薄膜——
              //   **只挡敌弹**（敌弹 filter 含 GROUP_SLIT_PLAYER）；玩家/友军弹剔除本组 → 自由穿。
              ...(opts.owner === 'player' ? [{
                shape: { type: 'cuboid' as const, hx: COVER_SLIT_W / 2, hy: (COVER_SLIT_Y1 - COVER_SLIT_Y0) / 2, hz: COVER_T / 2 },
                offset: { x: 0, y: (COVER_SLIT_Y0 + COVER_SLIT_Y1) / 2, z: 0 },
                groups: (GROUP_SLIT_PLAYER << 16) | 0xffff,
              }] : []),
            ],
            collisionGroups: groups,
          },
        }
      : {
          type: 'fixed',
          options: {
            shape: { type: 'cuboid', hx: COVER_W / 2, hy: COVER_H / 2, hz: COVER_T / 2 },
            shapeOffset: { x: 0, y: COVER_H / 2, z: 0 },
            collisionGroups: groups,
          },
        };
    super(em, {
      x: opts.x, y: opts.y, z: opts.z,
      physics: phys,
      // ★ 中立实体：双方子弹都能打（sameTeam 只对 player/ally 互免）
      camp: 'neutral',
      hp: opts.hp ?? COVER_HP,
      defense: 2,
    });
    this.owner = opts.owner ?? 'enemy';
    this.variant = opts.variant ?? 'cover';
    this.poster = opts.poster !== false;
    this.hasSlit = this.variant !== 'wall';
    this.heading = opts.heading ?? 0;
    this.baseMaxHp = this.maxHp;
    this.baseDefense = this.defense;
    this.buildTime = opts.buildTime ?? 0;
    // ★ 建造进度必须与渲染器同步（否则基类默认 1 → onUpdate 直接 return，永远停在起始缩放）
    this.buildProgress = this.buildTime > 0 ? 0 : 1;
    this.attachToScene(scene);
    const r = this.renderer as CoverRenderer | null;
    r?.setYaw(this.heading);
    if (this.buildTime > 0) r?.setBuildProgress(0);
    // ★ 血条（双方可见；跟随墙顶）
    this.attachEffect('health', new HealthBar(scene, this, {
      width: 1.2,
      offsetY: COVER_H + 0.4,
    }));
    // ★ 角色阻挡（所有 CharacterBase 的 separateFromStatics 消费）：
    //   半宽/半厚/半高；yaw = 墙朝向；walkableTop=true（顶面可站/可攀）
    this.blockId = -(this.entity.id * 16 + 1);
    addStaticObstacleRect(
      this.blockId, opts.x, opts.y + COVER_H / 2, opts.z,
      COVER_W / 2, COVER_T / 2, COVER_H / 2, this.heading, true, true,
    );
    _coverRegistry.add(this);
  }

  /** ★ 城墙光环结算（由 updateWallAuras 调用）：多座城墙**叠加**（上限/防御/修复相加），范围内持续回血 */
  applyAura(bonusHp: number, bonusDef: number, healPerSec: number, dt: number): void {
    const maxHp = this.baseMaxHp + bonusHp;
    this.maxHp = maxHp;
    this.defense = this.baseDefense + bonusDef;
    if (this.hp > maxHp) this.hp = maxHp;
    if (healPerSec > 0 && this.hp < maxHp) {
      this.hp = Math.min(maxHp, this.hp + healPerSec * dt);
    }
  }

  /** ★ 顶面高度（世界 Y；点在墙足迹内才返回）——角色落顶/攀爬目标 */
  topAt(x: number, z: number): number | null {
    const p = this.entity.position;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const dx = x - p.x, dz = z - p.z;
    const lz = dx * fx + dz * fz;   // 厚度轴
    const lx = dx * fz - dz * fx;   // 宽度轴
    if (Math.abs(lx) > COVER_W / 2 || Math.abs(lz) > COVER_T / 2) return null;
    return p.y + COVER_H;
  }

  override dispose(): void {
    _coverRegistry.delete(this);
    removeStaticObstacle(this.blockId);
    super.dispose();
  }

  protected createRenderer(scene: THREE.Scene): CoverRenderer {
    // ★ 海报口径（2026-09-19 用户定调）：**玩家造的有海报，敌人造的没有**。
    //   城墙 = 不许笑的脸；墙 = 土木老姐的脸（资产在 public/fx/）
    const iconUrl = this.hasSlit
      ? '/characters/protagonist/不许笑.ftx3.gz'   // 城墙：不许笑（资产在 protagonist）
      : '/fx/土木老姐.ftx3.gz';                    // 墙：土木老姐
    return new CoverRenderer(scene, this.hasSlit, this.poster ? iconUrl : null);
  }

  /** 建造插值推进（0→1 长高）+ ★ 随地面变化插值（挖坑/地形改动时平滑沉/升） */
  protected override onUpdate(dt: number): void {
    if (this.buildProgress < 1) {
      this.buildElapsed += dt;
      this.buildProgress = Math.min(1, this.buildTime > 0 ? this.buildElapsed / this.buildTime : 1);
      (this.renderer as CoverRenderer | null)?.setBuildProgress(this.buildProgress);
    }
    // ★ 支撑面跟随（插值）：地形 / **下方墙顶**（墙上叠墙时不被地形拽下去）；
    //   变化超过阈值才同步刚体/阻挡索引
    const p = this.entity.position;
    let gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? p.y;
    const support = coverSupportAt(p.x, p.z, p.y, this);
    if (support !== null && support > gy) gy = support;
    const dy = gy - p.y;
    if (Math.abs(dy) > 1e-3) {
      p.y += dy * Math.min(1, dt * 4);
      this.syncGround();
    }
  }

  /** 地面高度变化后：同步 fixed 刚体 + 重建角色阻挡索引（同 id remove→add） */
  private syncGround(): void {
    const p = this.entity.position;
    const rb = this.entity.rigidBody;
    const phys = this.em.physics;
    if (rb && phys) phys.setPosition(rb.handle, p.x, p.y, p.z);
    removeStaticObstacle(this.blockId);
    addStaticObstacleRect(
      this.blockId, p.x, p.y + COVER_H / 2, p.z,
      COVER_W / 2, COVER_T / 2, COVER_H / 2, this.heading, true, true,
    );
  }

  /** ★ 表现 LOD：几何体不参与 renderAll 的贴片 LOD，这里按距离直接隐藏（lod≥3） */
  override applyViewDistance(distance: number): void {
    super.applyViewDistance(distance);
    (this.renderer as CoverRenderer | null)?.setVisible(this.visible && this.viewLod < 3);
  }
}
