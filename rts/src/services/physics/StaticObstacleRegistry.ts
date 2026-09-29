// ============================================================
// StaticObstacleRegistry —— 程序化装饰物（fixed cuboid）的 JS 侧空间索引
// ============================================================
// 背景：角色"静态障碍推挤"原走 rapier queryStaticObstacles
//   （intersectionWithShape + 逐个排除碰撞体循环）——装饰物密集区单次可达毫秒级。
//   静态数据不需要物理引擎每帧查询：创建碰撞体时登记，销毁时注销即可。
// 生命周期：WorldMode.createPropBody 登记 / destroyGround 注销（同一实体 id）。
// 查询：半径圆 → 邻近 8m 网格桶收集（去重），开销 = 邻近桶内障碍数。
// ============================================================

import { COVER_H } from '../render/CoverRenderer';   // ★ 攀爬上限单源 = 掩体高

export interface StaticObstacle {
  id: number;
  x: number; z: number; y: number;
  /** 水平半径（圆形障碍：cuboid hx=hz=r；矩形障碍时 = max(hw,hl)，仅作参考） */
  r: number;
  /** 半高（cuboid hy） */
  hy: number;
  /** 查询去重标记（内部用） */
  q: number;
  /** ★ 定向矩形（可选；船体分段等）：局部半宽 hw / 半长 hl / 朝向 yaw */
  hw?: number;
  hl?: number;
  yaw?: number;
  /** ★ 顶面可站（船体）：脚底 ≥ 顶面-0.1 时不再推挤（站/跳在顶上不推） */
  walkableTop?: boolean;
  /** ★ 墙标记（城墙/墙）：近战线段被其截断（墙挡近战，2026-09-19） */
  wall?: boolean;
  /** 桶半径（内部：圆=r；矩形=外接半径） */
  br: number;
}

const CELL = 8;
/** 网格桶：key = (ix+4096)*8192 + (iz+4096) */
const buckets = new Map<number, StaticObstacle[]>();
/** 存活障碍（id → 障碍；注销用） */
const live = new Map<number, StaticObstacle>();
/** 查询序号（去重标记） */
let querySeq = 0;

function bucketKey(ix: number, iz: number): number {
  return (ix + 4096) * 8192 + (iz + 4096);
}

/** 登记装饰物碰撞体（x,y,z = 体中心；r = 水平半径；hy = 半高） */
export function addStaticObstacle(id: number, x: number, y: number, z: number, r: number, hy: number): void {
  insert({ id, x, y, z, r, hy, q: 0, br: r });
}

/** ★ 定向矩形障碍（船体分段）：局部 +z = 朝向；walkableTop = 顶面可站（脚底在顶面以上不推） */
export function addStaticObstacleRect(
  id: number, x: number, y: number, z: number,
  hw: number, hl: number, hy: number, yaw: number,
  walkableTop = true, wall = false,
): void {
  const br = Math.hypot(hw, hl);
  insert({ id, x, y, z, r: Math.max(hw, hl), hy, q: 0, hw, hl, yaw, walkableTop, wall, br });
}

function insert(o: StaticObstacle): void {
  const r = o.br;
  live.set(o.id, o);
  const x0 = Math.floor((o.x - r) / CELL), x1 = Math.floor((o.x + r) / CELL);
  const z0 = Math.floor((o.z - r) / CELL), z1 = Math.floor((o.z + r) / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const k = bucketKey(ix, iz);
      let arr = buckets.get(k);
      if (!arr) { arr = []; buckets.set(k, arr); }
      arr.push(o);
    }
  }
}

/** 注销装饰物碰撞体（不存在 = no-op；地面 trimesh 会安全命中此分支） */
export function removeStaticObstacle(id: number): void {
  const o = live.get(id);
  if (!o) return;
  live.delete(id);
  const x0 = Math.floor((o.x - o.br) / CELL), x1 = Math.floor((o.x + o.br) / CELL);
  const z0 = Math.floor((o.z - o.br) / CELL), z1 = Math.floor((o.z + o.br) / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const arr = buckets.get(bucketKey(ix, iz));
      if (!arr) continue;
      const i = arr.indexOf(o);
      if (i !== -1) { arr[i] = arr[arr.length - 1]; arr.pop(); }
    }
  }
}

/** 半径圆内障碍（写入调用方缓冲，零分配；已去重，命中需调用方按水平距离再筛） */
export function queryStaticObstaclesInto(
  px: number, pz: number, radius: number, out: StaticObstacle[],
): void {
  out.length = 0;
  querySeq++;
  const seq = querySeq;
  const x0 = Math.floor((px - radius) / CELL), x1 = Math.floor((px + radius) / CELL);
  const z0 = Math.floor((pz - radius) / CELL), z1 = Math.floor((pz + radius) / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const arr = buckets.get(bucketKey(ix, iz));
      if (!arr) continue;
      for (const o of arr) {
        if (o.q === seq) continue;
        o.q = seq;
        out.push(o);
      }
    }
  }
}

// ============================================================
// ★ 被动爬掩体（用户定 2026-09-27）：与地形爬坡点同构、**无需凭证**——靠近就爬。
//   消费方：L2 代理经 RasterProbe.climbPoint 兜底（CharacterCore 传送带直接抓）；
//           L3 实体已有"顶住 0.25s 自动翻"（CharacterBase.climbCand），同一条口径。
// ============================================================

/** 爬越段（与地形 ClimbRun 同构；top = 顶面世界高，passive 标记免凭证/免认领） */
export interface CoverClimbRun {
  x: number; z: number;
  ux: number; uz: number;
  lx: number; lz: number;
  top: number;
  passive: true;
}

/** 可攀工事最大高差（米；**单源 = 掩体高**——掩体加高后此处不跟就会"爬不上去"）
 *  ★ 2026-09-29 修：原写死 3.2，掩体加高到 COVER_H=4.5 后 rise 4.5 > 3.2 → 永不触发攀爬。 */
export const COVER_CLIMB_MAX = COVER_H;

const _coverBuf: StaticObstacle[] = [];

/** 被动爬掩体查询：单位正前方接触区若有可站顶工事（高差 0.4~COVER_CLIMB_MAX）→ 返回爬越段。
 *  法线 = 单位当前前进方向（越到对侧）；起点的 sOff 基准 = 单位当前位置（P2 传送带口径）。 */
export function coverClimbAt(
  px: number, pz: number, py: number, dirX: number, dirZ: number, reach = 1.6,
): CoverClimbRun | null {
  const dl = Math.hypot(dirX, dirZ);
  if (dl < 1e-3) return null;
  const ux = dirX / dl, uz = dirZ / dl;
  queryStaticObstaclesInto(px, pz, reach + 1.5, _coverBuf);
  let best: CoverClimbRun | null = null;
  let bestD = Infinity;
  for (const o of _coverBuf) {
    if (!o.walkableTop) continue;                       // 只爬可站顶工事（掩体/船体）
    const top = o.y + o.hy;
    const rise = top - py;
    if (rise < 0.4 || rise > COVER_CLIMB_MAX) continue; // 太低不爬 / 太高（规划绕行）
    if (py >= top - 0.2) continue;                      // 已在顶上
    // ★ 最近点（OBB 局部夹取 / 圆沿连线）：长墙也能在前方接触区被识别（中心可能很远）
    let cx: number, cz: number, thick = o.r;
    if (o.hw !== undefined && o.hl !== undefined && o.yaw !== undefined) {
      const fx = Math.sin(o.yaw), fz = Math.cos(o.yaw);   // 局部 +z（正面）
      const rx2 = fz, rz2 = -fx;                          // 局部 +x
      const vx = px - o.x, vz = pz - o.z;
      const lx = vx * rx2 + vz * rz2, lz = vx * fx + vz * fz;
      const clx = Math.max(-o.hw, Math.min(o.hw, lx));
      const clz = Math.max(-o.hl, Math.min(o.hl, lz));
      cx = o.x + clx * rx2 + clz * fx;
      cz = o.z + clx * rz2 + clz * fz;
      thick = Math.abs(o.hw * (ux * rx2 + uz * rz2)) + Math.abs(o.hl * (ux * fx + uz * fz));
    } else {
      const vx = px - o.x, vz = pz - o.z;
      const d = Math.hypot(vx, vz) || 1;
      const cl = Math.min(d, o.r);
      cx = o.x + (vx / d) * cl;
      cz = o.z + (vz / d) * cl;
    }
    const wx = cx - px, wz = cz - pz;
    const along = wx * ux + wz * uz;
    const lat = wx * (-uz) + wz * ux;
    const dist = Math.hypot(wx, wz);
    if (along < 0.1 || dist > reach) continue;          // 正前方接触区（靠得够近就爬）
    if (Math.abs(lat) > 1.0) continue;                  // 不偏路
    const d2 = Math.hypot(o.x - px, o.z - pz);
    if (d2 < bestD) {
      bestD = d2;
      best = { x: px, z: pz, ux, uz,
        lx: cx + ux * (thick + 0.8), lz: cz + uz * (thick + 0.8),
        top, passive: true };
    }
  }
  return best;
}

