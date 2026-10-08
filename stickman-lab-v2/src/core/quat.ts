/**
 * quat.ts —— 四元数工具（全工程唯一一份）
 *
 * 为什么单独一份：v1 把同一组公式抄在 skeleton.ts / ragdoll.ts / executor.ts 三处，
 * 改一处忘一处 ⇒ 静默不一致（v1 的 `quatRel` 与 `quatInvRotate` 约定打架就是一例）。
 *
 * 约定：四元数 (x, y, z, w)，单位模长；旋转向量 = axis · angle。
 */

export interface Quat { x: number; y: number; z: number; w: number }
export interface Vec3 { x: number; y: number; z: number }

export const QUAT_ID: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** a ⊗ b */
export function qMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** q⁻¹（单位四元数即共轭） */
export function qConj(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** 绕单位轴 (ax,ay,az) 转 ang 弧度 */
export function qAxisAngle(ax: number, ay: number, az: number, ang: number): Quat {
  const s = Math.sin(ang / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(ang / 2) };
}

/** out = q 旋转向量 v（写入 out[0..2]，不分配） */
export function qRotateVec(q: Quat, vx: number, vy: number, vz: number, out: Float64Array): void {
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  out[0] = vx + q.w * tx + (q.y * tz - q.z * ty);
  out[1] = vy + q.w * ty + (q.z * tx - q.x * tz);
  out[2] = vz + q.w * tz + (q.x * ty - q.y * tx);
}

/** out = q⁻¹ 旋转向量 v（世界 → 本地） */
export function qInvRotateVec(q: Quat, vx: number, vy: number, vz: number, out: Float64Array): void {
  qRotateVec({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, vx, vy, vz, out);
}

/** out = conj(a) ⊗ b（子相对父的姿态，表达在父系） */
export function qRel(a: Quat, b: Quat): Quat {
  return qMul(qConj(a), b);
}

/**
 * 相对姿态里绕指定本地轴的**有符号角**（弧度，∈[−π, π]）。
 *
 * 用途：串联铰链的关节角读数。对于约束正确的关节，`qrel` 应恰好是绕该轴的
 * 纯旋转；若因数值漂移带有微小离轴分量，取投影是稳健的。
 */
export function qSignedAngle(qrel: Quat, ax: number, ay: number, az: number): number {
  const v = qrel.x * ax + qrel.y * ay + qrel.z * az;
  return 2 * Math.atan2(v, qrel.w);
}

/**
 * 相对姿态的旋转向量（exponential map，|out| ≤ π），写入 out[0..2]。
 * 取最短表示：角度 > π 时换反向轴。
 */
export function qToRotVec(q: Quat, out: Float64Array): void {
  const w = q.w > 1 ? 1 : q.w < -1 ? -1 : q.w;
  const half = Math.acos(w);
  const s = Math.sin(half);
  if (s < 1e-7) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
  const ang = 2 * half;
  const k = ang > Math.PI ? -(2 * Math.PI - ang) / s : ang / s;
  out[0] = q.x * k; out[1] = q.y * k; out[2] = q.z * k;
}

/**
 * 把相对旋转分解为**内旋 XYZ Euler 角**（q = Rx·Ry·Rz 作用在父系）。
 *
 * 用途：球窝关节 → 3×revolute 串联的**起姿态**。
 *   · 每个 sub-revolute 的零点 = "两侧姿态相同"；
 *   · 按 (φ1,φ2,φ3) 依次旋转两个中间体 ⇒ 三个关节**出生即零点**，不注入能量；
 *   · 人形关节的三轴运动链本来就是"屈伸→外展→扭转"的内旋序列，与解剖一致。
 *
 * 返回 [φ1, φ2, φ3]；gimbal lock（φ2 = ±90°）不在本骨架限位范围内，不处理。
 */
export function qEulerXYZ(q: Quat): [number, number, number] {
  const { x, y, z, w } = q;
  const R00 = 1 - 2 * (y * y + z * z), R01 = 2 * (x * y - z * w), R02 = 2 * (x * z + y * w);
  const R12 = 2 * (y * z - x * w), R22 = 1 - 2 * (x * x + y * y);
  const p2 = Math.asin(Math.max(-1, Math.min(1, R02)));
  const p1 = Math.atan2(-R12, R22);
  const p3 = Math.atan2(-R01, R00);
  return [p1, p2, p3];
}

/** 只读视图 → 普通对象（Rapier 返回的 Rotation 可直传） */
export function qOf(q: { x: number; y: number; z: number; w: number }): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** 旋转向量 (x,y,z) → 四元数（qFromRotVec 与 qToRotVec 互为逆） */
export function qFromRotVec(x: number, y: number, z: number): Quat {
  const ang = Math.hypot(x, y, z);
  if (ang < 1e-12) return { x: 0, y: 0, z: 0, w: 1 };
  const s = Math.sin(ang / 2) / ang;
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(ang / 2) };
}

/**
 * swing-twist 分解（Baerlocher & Boulic 2001, "Parametrization and Range of
 * Motion of the Ball-and-Socket Joint"）：
 *
 *   q = q_swing ⊗ q_twist，扭转轴 = 本地 Y（肢体长轴）。
 *   返回 [twist, swingX, swingZ]：
 *     · twist  = 绕长轴的自转（骨架轴 1）；
 *     · swingX = 摆动的 X 分量（外展，骨架轴 0）；
 *     · swingZ = 摆动的 Z 分量（屈伸，骨架轴 2）。
 *
 * 比"旋转向量三分量"科学的地方：旋转向量在复合旋转下三分量互相污染
 * （实测球铰 axis0 的 ±τ 对称性只有 80%），swing 与 twist 按解剖解耦；
 * swing 自身是单个轴角，写回 X/Z 分量在人类活动范围内与解剖轴一致。
 * ⚠ 摆动极限（|swing| → π）处退化（和万向节锁同类），本骨架远未达到。
 */
export function swingTwistY(q: Quat, out: Float64Array): void {
  // 1) twist 分量：向量部分向 Y 投影
  let ty = q.y, tw = q.w;
  const tl = Math.hypot(ty, tw);
  if (tl < 1e-12) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
  ty /= tl; tw /= tl;
  const twist = 2 * Math.atan2(ty, tw);
  // 2) swing = q ⊗ conj(q_twist)
  const qt: Quat = { x: 0, y: ty, z: 0, w: tw };
  const qs = qMul(q, qConj(qt));
  const vlen = Math.hypot(qs.x, qs.y, qs.z);
  if (vlen < 1e-12) { out[0] = twist; out[1] = 0; out[2] = 0; return; }
  let ang = 2 * Math.atan2(vlen, qs.w);
  if (ang > Math.PI) ang -= 2 * Math.PI;
  const k = ang / vlen;
  out[0] = twist;
  out[1] = qs.x * k;
  out[2] = qs.z * k;
}
