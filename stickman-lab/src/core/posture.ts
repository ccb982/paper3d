// ============================================================
// posture —— 重心 / 支撑域 / DCM（捕获点）
// ============================================================
// 为什么要有这个文件：
//   原来的观测（88 维）里**根本没有重心** —— 全是胸腔（四元数/线速度/角速度/高度/侧偏）
//   + 12 关节角/角速度 + 左右脚高。策略在**原理上**拿不到"我在往哪倒"，
//   只能靠胸腔姿态间接推。adapt 的直立项也一样（惩罚 `cos(tiltOf(chest))`，
//   而胸腔只占 12.4% 质量、中心离 CoM 0.4635 m）。
//   实测症状就是这个："直立占比 48~97%、净前进 0.37 m、**仍判摔**"。
//
// 本文件补上三个量 + 一个域：
//     CoM 位置 / CoM 速度 / DCM（ξ = x + ẋ/ω）/ 支撑域（CoP 可行域）
//   DCM 只有**相对支撑域**才有意义（判据是 ξ 落在域内）。
//
// ★★ 支撑域必须报**两个**，别只报凸包（probe-push [Z] 段的教训）：
//   · 主动半宽（凸包）—— 接地足迹的凸包。这需要**差动卸载一只脚**才能达到，
//     是控制任务的上界，不是几何事实。
//   · 被动半宽（等载荷）—— 两脚各承一半时，净 CoP = **两脚 CoP 的平均值**
//     ⇒ 其可达范围 = 两脚足迹宽度的平均的一半，**与站姿宽度无关**。
//       两脚等宽时它就等于「单只脚的宽度 ÷ 2」。
//   实测 1.8 m 人形（绑定姿态）：前后 被动 = 主动 = ±0.110；
//                              侧向 被动 **±0.070** / 主动 ±0.266（被动只占 26%）。
//   ⇒ 拿凸包当阈值会把静息平衡权限高估 4 倍。**适应度惩罚必须用被动半宽。**
//
// ★ 零分配：全部写进调用方预分配的缓冲（每控制周期调用一次，48 个体并行）。

import type { Ragdoll } from './ragdoll';

/** 重力加速度（与 ragdoll.ts 建世界时用的一致） */
export const GRAVITY_Y = 9.81;

/** 脚掌"算接地"的判定高度（m）。与 sim.ts 里原来判"迈步"的 0.07 不同：
 *  那个是为了数步子故意放宽，这个是为了算支撑域必须收紧。 */
export const CONTACT_Y = 0.03;

/** 支撑域半宽的兜底下限（m）—— 腾空/除零保护，避免适应度惩罚爆掉 */
const MIN_HALF = 0.04;

export interface ComState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

export interface Support {
  /** 支撑域中心 = 接地脚脚印中心的平均 */
  cx: number; cz: number;
  /** 前后半宽（**被动**；两脚同向 ⇒ 被动 = 主动） */
  halfX: number;
  /** 侧向**被动**半宽（等载荷可达；适应度/观测都用它） */
  halfZ: number;
  /** 侧向主动半宽（凸包；需差动卸载才可达，只作诊断输出） */
  halfZActive: number;
  /** 接地脚数：0 / 1 / 2 */
  contactN: number;
}

export function newCom(): ComState {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
}

export function newSupport(): Support {
  return { cx: 0, cz: 0, halfX: 0, halfZ: 0, halfZActive: 0, contactN: 0 };
}

/** LIPM 的 ω = √(g / z_c)。z_c = CoM 高度 */
export function omegaAt(comY: number): number {
  return Math.sqrt(GRAVITY_Y / (comY > 0.05 ? comY : 0.05));
}

/** DCM（捕获点 / 发散分量）ζ 分量：ξ = x + ẋ/ω */
export function dcm(x: number, vx: number, omega: number): number {
  return x + vx / omega;
}

// ---------------------------------------------------------------- 读状态

/** 质量加权重心（位置 + 速度）。每刚体 3 次 wasm 调用（mass / worldCom / linvel） */
export function readCom(doll: Ragdoll, out: ComState): ComState {
  let mt = 0, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
  for (const b of doll.bodies) {
    const m = b.mass();
    const c = b.worldCom();
    const v = b.linvel();
    mt += m;
    x += m * c.x; y += m * c.y; z += m * c.z;
    vx += m * v.x; vy += m * v.y; vz += m * v.z;
  }
  if (mt <= 0) { out.x = out.y = out.z = out.vx = out.vy = out.vz = 0; return out; }
  out.x = x / mt; out.y = y / mt; out.z = z / mt;
  out.vx = vx / mt; out.vy = vy / mt; out.vz = vz / mt;
  return out;
}

/** 四元数旋转 v → out[0..2]（本地自己的，免得依赖 ragdoll 的私有方法） */
function rotQ(
  qx: number, qy: number, qz: number, qw: number,
  vx: number, vy: number, vz: number, out: Float64Array,
): void {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}

interface FootRect {
  x0: number; x1: number; z0: number; z1: number;
  /** 四角的最高… 不，最低点世界 y（接地判据） */
  minY: number;
  /** 脚印中心 */
  cx: number; cz: number;
}

const RECT_L: FootRect = { x0: 0, x1: 0, z0: 0, z1: 0, minY: 0, cx: 0, cz: 0 };
const RECT_R: FootRect = { x0: 0, x1: 0, z0: 0, z1: 0, minY: 0, cx: 0, cz: 0 };
const V3 = new Float64Array(3);

/**
 * 脚掌底面四角的世界足迹（轴对齐包围盒）。
 * ★ 不能写 `body.y − length/2`：刚体会转，最低点必须按姿态算（footPoint 的注释同理）。
 * 返回是否接地。
 */
function soleBodyIndex(doll: Ragdoll, side: 'l' | 'r'): number | undefined {
  // ★ 鞋底 collider 所在刚体：踝关节开启时是独立的 foot_l/foot_r，关闭时挂在小腿上
  //   （`ankleEnabled`，见 SkeletonConfig）。
  return doll.indexByKey.get(`foot_${side}`) ?? doll.indexByKey.get(side === 'l' ? 'shin_l' : 'shin_r');
}

function footRect(doll: Ragdoll, side: 'l' | 'r', out: FootRect): boolean {
  const idx = soleBodyIndex(doll, side);
  if (idx === undefined) return false;
  const bd = doll.sk.bodies[idx];
  const b = doll.bodies[idx];
  const t = b.translation();
  const q = b.rotation();

  const sole = bd.colliders.find((c) => c.shape === 'cuboid');
  const hx = sole && sole.shape === 'cuboid' ? sole.hx : 0.02;
  const hy = sole && sole.shape === 'cuboid' ? sole.hy : 0.01;
  const hz = sole && sole.shape === 'cuboid' ? sole.hz : 0.02;
  const oy = (sole ? sole.offsetY : -bd.length / 2) - hy;

  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, minY = Infinity;
  for (let si = 0; si < 4; si++) {
    rotQ(q.x, q.y, q.z, q.w, (si & 1 ? 1 : -1) * hx, oy, (si & 2 ? 1 : -1) * hz, V3);
    const wx = t.x + V3[0], wy = t.y + V3[1], wz = t.z + V3[2];
    if (wx < x0) x0 = wx;
    if (wx > x1) x1 = wx;
    if (wz < z0) z0 = wz;
    if (wz > z1) z1 = wz;
    if (wy < minY) minY = wy;
  }
  out.x0 = x0; out.x1 = x1; out.z0 = z0; out.z1 = z1; out.minY = minY;
  out.cx = (x0 + x1) / 2; out.cz = (z0 + z1) / 2;
  return minY <= CONTACT_Y;
}

/**
 * ★ 脚是否接地（几何判据：鞋底盒 4 个底角里最低的�� ≤ CONTACT_Y）。
 *   腾空时间（feet air time）和"单脚支撑"两项奖励都用它 —— 经典配方里
 *   **交替步态是从这一项长出来的**，不需要任何相位/换脚检测。
 */
export function footGrounded(doll: Ragdoll, side: 'l' | 'r'): boolean {
  // ★ 用 **Rapier 真实接触对**，不是几何判据（几何有 3cm 死区，实测脚抬 9cm 仍判着地）。
  return doll.footGrounded(side === 'l' ? 0 : 1);
}

/**
 * 读支撑域（每控制周期一次）。
 * ★ 被动 vs 主动的区别见文件头 —— 观测与适应度一律用**被动**半宽。
 */
export function readSupport(doll: Ragdoll, out: Support): Support {
  // ★ 支撑域的"接地"也改用真实接触（足迹矩形仍由几何算），两者口径一致。
  const inL = footRect(doll, 'l', RECT_L) && doll.footGrounded(0);
  const inR = footRect(doll, 'r', RECT_R) && doll.footGrounded(1);
  const wLx = RECT_L.x1 - RECT_L.x0, wRx = RECT_R.x1 - RECT_R.x0;
  const wLz = RECT_L.z1 - RECT_L.z0, wRz = RECT_R.z1 - RECT_R.z0;

  // 主动域（凸包）= 接地足迹的并集；腾空时退回两脚全足迹（只为不除零，值本身无意义）
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
  if (inL) { x0 = Math.min(x0, RECT_L.x0); x1 = Math.max(x1, RECT_L.x1); z0 = Math.min(z0, RECT_L.z0); z1 = Math.max(z1, RECT_L.z1); n++; }
  if (inR) { x0 = Math.min(x0, RECT_R.x0); x1 = Math.max(x1, RECT_R.x1); z0 = Math.min(z0, RECT_R.z0); z1 = Math.max(z1, RECT_R.z1); n++; }
  if (n === 0) {
    x0 = Math.min(RECT_L.x0, RECT_R.x0); x1 = Math.max(RECT_L.x1, RECT_R.x1);
    z0 = Math.min(RECT_L.z0, RECT_R.z0); z1 = Math.max(RECT_L.z1, RECT_R.z1);
  }

  // 中心与**被动**半宽：净 CoP = 接地脚 CoP 的平均 ⇒ 范围 = 各脚足迹宽度的平均 / 2
  let cx: number, cz: number, halfX: number, halfZ: number;
  if (inL && inR) {
    // ★★ 双脚都着地时，**按法向载荷加权**，不是简单平均。
    //
    //   用户 2026-10-04 明确：「我不要双脚着地均匀受力的情况，
    //   我只想要尽可能重心向一只脚移动」。
    //
    //   原来的 `(L+R)/2` 有一个隐蔽后果：**双脚均匀承重被固化成"正常基准"**。
    //   双脚各承 50% 时 `cz` = 两脚中点、`halfZ` = 平均半宽 ⇒ 无论人怎么把重心
    //   往左偏，只要右脚还碰着地，基准就跟着往中点漂 ⇒ 控制器永远觉得"居中"，
    //   **单腿交接永远不会启动**。这正是此前 `loadL/loadR` 能从 0.28/0.72 一路爬
    //   却在 20s 内反复换腿、CoM 峰值只有 34mm 的结构性原因。
    //
    //   加权后语义才对：
    //   · 某脚载荷 → 0 ⇒ 权重 → 0 ⇒ 基准**自动倒向另一只脚**（交接发生）
    //   · 两脚相等 ⇒ 退化为原来的中点（与旧行为一致，不引入新偏置）
    //   · 一脚独承 ⇒ `cz` 完全等于那只脚自己的中心（等价于单腿分支）
    //
    //   权重用 `footLoadFrac`（正规回读接口，Σ 载荷归一）。任一项读不到则退回平均。
    // ★ 一次调用取两脚（`footLoadFrac` 返回 `[左, 右]`，参数是 **dt** 不是 side）。
    //   dt 传 0 已由 `Ragdoll.footLoadFrac` 内部兜底成本机物理步长（见那里的注释）。
    const flr = doll.footLoadFrac(0);
    const fL = inL ? flr[0] : 0;
    const fR = inR ? flr[1] : 0;
    const sum = fL + fR;
    if (Number.isFinite(sum) && sum > 1e-6) {
      const uL = fL / sum, uR = fR / sum;
      cx = RECT_L.cx * uL + RECT_R.cx * uR;
      cz = RECT_L.cz * uL + RECT_R.cz * uR;
      // 半宽同样按权重：**主力腿的足迹宽度**才是有效支撑宽度
      halfX = wLx * uL * 0.5 + wRx * uR * 0.5;
      halfZ = wLz * uL * 0.5 + wRz * uR * 0.5;
    } else {
      cx = (RECT_L.cx + RECT_R.cx) / 2; cz = (RECT_L.cz + RECT_R.cz) / 2;
      halfX = (wLx + wRx) / 4;
      halfZ = (wLz + wRz) / 4;
    }
  } else if (inL) {
    cx = RECT_L.cx; cz = RECT_L.cz; halfX = wLx / 2; halfZ = wLz / 2;
  } else if (inR) {
    cx = RECT_R.cx; cz = RECT_R.cz; halfX = wRx / 2; halfZ = wRz / 2;
  } else {
    cx = (RECT_L.cx + RECT_R.cx) / 2; cz = (RECT_L.cz + RECT_R.cz) / 2;
    halfX = (wLx + wRx) / 4; halfZ = (wLz + wRz) / 4;
  }

  out.cx = cx; out.cz = cz;
  out.halfX = Math.max(MIN_HALF, halfX);
  out.halfZ = Math.max(MIN_HALF, halfZ);
  out.halfZActive = Math.max(out.halfZ, (z1 - z0) / 2);
  out.contactN = n;
  return out;
}

/**
 * DCM 越界量（**归一化**，0 = 正好在域边缘，1 = 越出整整一个半宽）。
 * 事先定成无量纲是刻意的：惩罚项要跨"站立（half≈0.07）"和"迈步（half 变化）"两种情况都可比。
 */
export function dcmExcess(
  xi: number, center: number, half: number,
): number {
  const e = Math.abs(xi - center) / half - 1;
  return e > 0 ? e : 0;
}
