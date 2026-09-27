// ============================================================
// swarm/EntitySeparation —— 敌人间碰撞斥力（接触修正；用户定 2026-09-27）
// ============================================================
// 两个/多个敌人挤到一起 → 沿圆心连线给**等大反向**斥力（各推一半），限幅防爆推。
// 纯计算（网格分桶，O(n) 级）；位移落地由调用方过 H2 闸门（canShift）后写入。
// 口径：这是**接触修正**，不是移动命令——不选择方向、不换目标（M0 允许）。
// ============================================================

export interface SepBody { x: number; z: number; y: number; r: number; }

const CELL = 6;   // 分桶边长（米；> 两倍最大半径 → 3×3 邻域足够）
const grid = new Map<number, number[]>();
let pushX = new Float32Array(0);
let pushZ = new Float32Array(0);

function keyOf(gx: number, gz: number): number {
  return gx * 100003 + gz;
}

/** 计算本单位间的斥力位移（等大反向）；返回复用的 push 数组（长度 n） */
export function separationPushes(bodies: readonly SepBody[], maxPush = 0.45): { x: Float32Array; z: Float32Array } {
  const n = bodies.length;
  if (pushX.length < n) { pushX = new Float32Array(n * 2); pushZ = new Float32Array(n * 2); }
  for (let i = 0; i < n; i++) { pushX[i] = 0; pushZ[i] = 0; }
  grid.clear();
  for (let i = 0; i < n; i++) {
    const b = bodies[i] as SepBody;
    const k = keyOf(Math.floor(b.x / CELL), Math.floor(b.z / CELL));
    let arr = grid.get(k);
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(i);
  }
  for (let i = 0; i < n; i++) {
    const a = bodies[i] as SepBody;
    const gx = Math.floor(a.x / CELL), gz = Math.floor(a.z / CELL);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const arr = grid.get(keyOf(gx + ox, gz + oz));
        if (!arr) continue;
        for (const j of arr) {
          if (j <= i) continue;
          const b = bodies[j] as SepBody;
          if (Math.abs(a.y - b.y) > 2) continue;          // 高度差大（飞行 vs 地面）不互推
          const dx = b.x - a.x, dz = b.z - a.z;
          const d = Math.hypot(dx, dz);
          const sum = a.r + b.r;
          if (d >= sum) continue;
          const inv = d > 1e-4 ? 1 / d : 0;
          const nx = d > 1e-4 ? dx * inv : 1;
          const nz = d > 1e-4 ? dz * inv : 0;
          const half = (sum - d) * 0.5;
          pushX[i] = (pushX[i] as number) - nx * half;
          pushZ[i] = (pushZ[i] as number) - nz * half;
          pushX[j] = (pushX[j] as number) + nx * half;
          pushZ[j] = (pushZ[j] as number) + nz * half;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const m = Math.hypot(pushX[i] as number, pushZ[i] as number);
    if (m > maxPush) {
      const k2 = maxPush / m;
      pushX[i] = (pushX[i] as number) * k2;
      pushZ[i] = (pushZ[i] as number) * k2;
    }
  }
  return { x: pushX, z: pushZ };
}
