// ============================================================
// TerrainSweep —— 子弹弹道 × 地形高度场 连续求交（数据层）
// ============================================================
// ★ 为什么需要（2026-11-07 实测定位「子弹穿透地块」根因）：
//   地形物理是【分区懒建】（ChunkManager.createChunkGround）：
//     · chunk 创建时**只同步建 1 个分区**（cells[0]，热点 chunk 则是脚下那个）；
//     · 其余 8 个分区进队列 3 个/帧补建（实测每个分区 collider 5.5~5.7ms）；
//     · 玩家周边 1 chunk 外的 8 个分区**永不预建**（LAZY_GROUND_RADIUS=1），
//       等玩家走近才补。
//   而视觉建造半径 ±2 chunk（120m）、子弹射程 150m（50m/s × 3s）
//   ⇒ **大片看得见的地形没有碰撞体** → 子弹打上去不产生物理接触
//     → 不挖坑、不被拦下 → 视觉上就是子弹穿地块。
//     （用户实测：「穿透往往出现在地块创建初期」——正是分区还没补齐的那几帧）
//
// ★ 不是 CCD 的锅（实测 rapier 0.14 真跑，50m/s、步长 1/60、球半径 0.05m）：
//     无 CCD → 1m 厚墙 / 水平薄面 / 30° 斜面  全部穿透
//     有 CCD → 三种场景全部挡住
//   ⇒ 刚体级 ccd:true 已足够（软 CCD 预测是冗余，已撤）。
//     穿透来自「没有碰撞体」，不是「漏检」。
//
// ★ 本模块的定位：**数据层**求交，不依赖任何物理 collider 的存在与否。
//   判据源 = RasterMap.baseSurfaceHeightAt（与渲染网格逐位一致的高度场；
//   角色贴地走的是同一份高度场 ⇒ 子弹与角色看到的是同一个「地面」）。
//   与 CombatSystem.updateAgentHits（线段扫掠打蜂群代理）同一套思路：
//   「会飞的东西用扫掠打不会动的代理」→ 现在扩展到「会飞的东西扫掠打地形」。
//
// ★ 高度场在崖壁处**不连续**（一格之内从 0m 跳到 8m）⇒ 高度二分细化会失效，
//   故按「相邻采样是否连续」分流：连续 → 高度二分（精确落点）；
//   不连续 → 水平插值（取崖面边缘，误差 ≤ 半步）。
//
// ★ 判据用【基面高度】（不含台座/围裙叠加层）：
//   台座/围裙有独立刚体（createStructuralGround，总是建好）→ 物理层负责；
//   基面高度才不会把台座顶当成「地面」而去挖它下面的地块。
// ============================================================

export interface SweepPoint {
  x: number;
  y: number;
  z: number;
}

/** 粗扫步长（米）：单物理步位移 ≤ ~1m（50m/s × 1/60）→ 2~3 段 */
const MARCH_STEP = 0.5;
const MARCH_MAX = 12;

/** 二分细化次数（6 次 ⇒ 精度 ~1m/64 ≈ 1.6cm） */
const REFINE_ITERS = 6;

/**
 * ★ 穿透判定阈值（米）：子弹中心必须真的沉到地面以下这么深才算穿透。
 *   擦地而过（子弹贴着地面飞）不算命中 ⇒ 平射不误挖坑。
 */
const PENETRATION_EPS = 0.05;

/** 崖壁判定阈值（米）：相邻采样高度差超过它 ⇒ 视为不连续（崖面） */
const CLIFF_JUMP = 1.5;

/**
 * ★ 快速剔除阈值（米）：整段都在地表之上这么高 ⇒ 本步不可能命中。
 *   单物理步位移 ≤ ~1m ⇒ 高于 2m 必然够不着 → 省掉大部分采样。
 */
const SKIP_ABOVE = 2.0;

/**
 * ★ 弹道线段 × 高度场：找「子弹沉入地表以下」的穿越点。
 *
 *   ★ 判定沿**整段扫描**（不是只看终点）：子弹从山的一侧射向另一侧时，
 *     终点可能在地面之上（穿山而过），只查端点会漏判。
 *
 * @param p0 弹道段起点（上一物理步位置）
 * @param p1 弹道段终点（当前物理步位置）
 * @param heightAt 地面高度采样（世界 x,z → 高度 y；null = 数据未加载 → 未知）
 * @param h0Hint 起点处已知的地表高度（上一物理步的终点高度）。相邻物理步的
 *   起点 = 上一步的终点 ⇒ 该高度已算出 → 传入可省一次采样。
 *   传 null（未知）则内部自行采样。**注意**：调用方需保证 p0 与上一步终点
 *   位置一致，否则该提示值与实际不符（会漏判）。
 * @param outEndH 可选出参：写入本段终点处的地表高度（供下一步当 h0Hint 复用）。
 * @returns 穿越点（x,z = 落点，y = 弹道在落点处的高度）；没穿过返回 null
 */
export function sweepTerrainCrossing(
  p0: SweepPoint,
  p1: SweepPoint,
  heightAt: (x: number, z: number) => number | null,
  h0Hint?: number | null,
  outEndH?: { h: number | null },
): SweepPoint | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const dz = p1.z - p0.z;
  const h1 = heightAt(p1.x, p1.z);
  // ★ 终点所在数据未加载 → 未知 → 不判（宁可漏判也不凭空挖坑）
  if (h1 === null) {
    if (outEndH) outEndH.h = null;
    return null;
  }
  // ★ 终点高度交出（下一步的起点高度提示）→ 每步省一次重复采样
  if (outEndH) outEndH.h = h1;

  // ---- 垂直弹道（水平位移≈0，如朝天/朝地直射）：直接比高度 ----
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-6) {
    if (p1.y < h1 - PENETRATION_EPS) return { x: p1.x, y: h1, z: p1.z };
    return null;
  }

  // ★ 起点高度：优先用上一步的终点高度（省一次采样）
  const h0 = h0Hint !== undefined && h0Hint !== null ? h0Hint : heightAt(p0.x, p0.z);
  // ---- 快速剔除：整段远高于地表 → 不可能命中 ----
  if (h0 !== null && p0.y - h0 > SKIP_ABOVE && p1.y - h1 > SKIP_ABOVE) return null;

  // ---- 粗扫：找第一个「沉入地表以下」的采样点 ----
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.min(MARCH_MAX, Math.ceil(len / MARCH_STEP)));
  let prevT = 0;
  let prevX = p0.x, prevY = p0.y, prevZ = p0.z;
  let prevH = h0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = p0.x + dx * t;
    const y = p0.y + dy * t;
    const z = p0.z + dz * t;
    const h = heightAt(x, z);
    if (h !== null && h - y > PENETRATION_EPS) {
      // 崖面（高度不连续）→ 水平插值定位穿越边；连续 → 高度二分（精确落点）
      if (prevH !== null && Math.abs(h - prevH) > CLIFF_JUMP) {
        return {
          x: prevX + (x - prevX) * 0.5,
          y: prevY + (y - prevY) * 0.5,
          z: prevZ + (z - prevZ) * 0.5,
        };
      }
      let lo = prevT, hi = t;
      for (let k = 0; k < REFINE_ITERS; k++) {
        const mid = (lo + hi) * 0.5;
        const mx = p0.x + dx * mid;
        const my = p0.y + dy * mid;
        const mz = p0.z + dz * mid;
        const mh = heightAt(mx, mz);
        if (mh !== null && mh - my > 0) hi = mid;
        else lo = mid;
      }
      const ft = (lo + hi) * 0.5;
      return { x: p0.x + dx * ft, y: p0.y + dy * ft, z: p0.z + dz * ft };
    }
    prevT = t; prevX = x; prevY = y; prevZ = z;
    if (h !== null) prevH = h;
  }
  return null;
}

/**
 * ★ 地面法线（高度场梯度 × 中心差分；e = 半采样间距）
 *   用于把子弹按地表法线反射（补上「没有 collider 时也要反弹」的物理表现）。
 */
export function terrainNormalAt(
  x: number,
  z: number,
  heightAt: (x: number, z: number) => number | null,
  e = 0.35,
): { x: number; y: number; z: number } {
  const hx1 = heightAt(x + e, z);
  const hx0 = heightAt(x - e, z);
  const hz1 = heightAt(x, z + e);
  const hz0 = heightAt(x, z - e);
  const hx = hx1 !== null && hx0 !== null ? hx1 - hx0 : 0;
  const hz = hz1 !== null && hz0 !== null ? hz1 - hz0 : 0;
  let nx = -hx / (2 * e);
  let ny = 1;
  let nz = -hz / (2 * e);
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  return { x: nx, y: ny, z: nz };
}
