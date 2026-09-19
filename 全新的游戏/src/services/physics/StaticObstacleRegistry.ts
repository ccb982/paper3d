// ============================================================
// StaticObstacleRegistry —— 程序化装饰物（fixed cuboid）的 JS 侧空间索引
// ============================================================
// 背景：角色"静态障碍推挤"原走 rapier queryStaticObstacles
//   （intersectionWithShape + 逐个排除碰撞体循环）——装饰物密集区单次可达毫秒级。
//   静态数据不需要物理引擎每帧查询：创建碰撞体时登记，销毁时注销即可。
// 生命周期：WorldMode.createPropBody 登记 / destroyGround 注销（同一实体 id）。
// 查询：半径圆 → 邻近 8m 网格桶收集（去重），开销 = 邻近桶内障碍数。
// ============================================================

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
