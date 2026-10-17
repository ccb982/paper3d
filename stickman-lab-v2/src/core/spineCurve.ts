/** spineCurve.ts —— 脊柱自然 S 形（运动学直摆；用户 2026-10-16："做成大致符合人类的 s 形腰椎"）
 *
 *  人类侧视 S（从骨盆往上）：
 *    · 腰段前凸（lordosis）：下腰段前倾（骶骨前倾的延续）→ 上腰段后倾（前凸完成）
 *    · 胸段后凸（kyphosis）：胸廓/肩带前移 = 驼背主段（用户："肩膀向前"）
 *    · 颈椎前凸：颈段后倾，头回到身体正上方
 *  符号：轴2 正=向后弯（stability.ts:240 sensX 实测；旧文档"正=前弯"为错）⇒ 前弯=负值。
 *
 *  净效果：胸廓前倾 ≈7°，头 ≈3° 前倾——自然站姿侧影。
 *  TR_CURVE 整体缩放（默认 1；0=关）。reset 后调用（World.reset 已接）。
 */
import type { Body } from './body';

type V3 = { x: number; y: number; z: number };
type Q4 = { x: number; y: number; z: number; w: number };

const qMul = (a: Q4, b: Q4): Q4 => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const qRot = (q: Q4, v: V3): V3 => {
  const { x, y, z, w: qw } = q;
  const ix = qw * v.x + y * v.z - z * v.y;
  const iy = qw * v.y + z * v.x - x * v.z;
  const iz = qw * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * qw + iw * -x + iy * -z - iz * -y,
    y: iy * qw + iw * -y + iz * -x - ix * -z,
    z: iz * qw + iw * -z + ix * -y - iy * -x,
  };
};
const axisAngleQ = (axis: V3, ang: number): Q4 => {
  const s = Math.sin(ang / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(ang / 2) };
};

const envNum = (k: string, d: number): number => {
  const v = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {})[k] ?? NaN);
  return Number.isFinite(v) ? v : d;
};

/** 绕关节锚点把下游链运动学旋转（court ② 同款） */
function rotChain(body: Body, jn: string, ang: number, chain: readonly string[]): void {
  // ★★ 2026-10-16 用户终极实测定案（300N·m 网页测试）：
  //   轴2 = 矢状轴（前后）；正 = 向后倒、负 = 向前倒。轴0 = 侧向（左右）。
  //   之前"轴0=矢状"的结论是错的（那批 S 全写进了侧向轴——难怪全横向倒）。
  const di = body.dofByName(jn, 2);
  if (di < 0) return;
  const d0 = body.dofs[di]!;
  const pivot: V3 = { x: d0.anchorWorld[0]!, y: d0.anchorWorld[1]!, z: d0.anchorWorld[2]! };
  // ★ 2026-10-17 用干净轴（dof 的 axisWorld 有 ~0.03 倾斜分量→S形引入 roll 不对称）
  const axis: V3 = { x: 0, y: 0, z: 1 };
  const rot = axisAngleQ(axis, ang);
  for (const key of chain) {
    const bi = body.indexByKey.get(key);
    if (bi === undefined) continue;
    const rb = body.bodies[bi]!;
    const p = rb.translation() as V3;
    const dp: V3 = { x: p.x - pivot.x, y: p.y - pivot.y, z: p.z - pivot.z };
    const dr = qRot(rot, dp);
    rb.setTranslation({ x: pivot.x + dr.x, y: pivot.y + dr.y, z: pivot.z + dr.z }, true);
    rb.setRotation(qMul(rot, rb.rotation() as Q4), true);
  }
  if (String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).SCU_NOSYNC ?? '0') !== '1') body.updateDofState();   // 刷新下游 dof 锚点/轴（下一步旋转用）
}

const UPPER = ['spine2', 'spine3', 'spine4', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'] as const;
const UPPER2 = ['spine3', 'spine4', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'] as const;
const UPPER3 = ['spine4', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'] as const;

/** 脊柱 S 形（在 reset 后调用；分度值见文件头）
 *  ★ 2026-10-16 用户："我一直要 s 形状的脊柱——只是想让上身不要再默认前倾，上身默认竖直（也别后倾）"
 *  ⇒ 分段取净和≈0：前-后-前-后 交替，胸廓累计 ≈ 0°（竖直） */
export function applySpineCurve(body: Body): void {
  const k = envNum('TR_CURVE', 1);
  if (!(k > 0)) return;
  // 人类 S：下腰前 → 上腰后 → 胸段前（微）→ 颈后（头回正）
  // ★ 符号：轴2 正=向后弯（stability.ts:240）⇒ 前弯=负
  // ★ 2026-10-16 用户回读校正："还不是前倾"——pitch 正=前倾（传感器 up[2]），
  //   S 形净和 = +3° ⇒ pitch=+3.0°
  // 前倾 = 负（轴2 正=后仰，用户 300N 实测定案）；净和 −3° ⇒ 上身微前倾 3°
  const s1 = envNum('TR_CURVE_S1', -0.07);   // 下腰段：前倾
  const s2 = envNum('TR_CURVE_S2', +0.10);   // 上腰段：后倾（前凸主段）
  const s3 = envNum('TR_CURVE_S3', -0.082);  // 胸段：前倾（净和 = −3°）
  const sn = envNum('TR_CURVE_N', +0.04);    // 颈段：后倾（头回正）
  rotChain(body, 'spine1', s1 * k, UPPER);
  rotChain(body, 'spine2', s2 * k, UPPER2);
  rotChain(body, 'spine3', s3 * k, UPPER3);
  rotChain(body, 'neck', sn * k, ['head']);
}
