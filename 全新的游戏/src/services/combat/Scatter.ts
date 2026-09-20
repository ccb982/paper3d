// ============================================================
// Scatter —— 射击散布（远距掩护性散射 / 近距精准；2026-09-20）
// ============================================================
// 绕竖直轴随机偏转 + 轻微俯仰抖动；原地修改 out（单位向量）。
// 代理（WorldMode.onAgentRanged）与实体（behaviors/EnemyBrain）共用同一套散布。
// ============================================================

export function scatterDir(out: { x: number; y: number; z: number }, spread: number): void {
  if (!(spread > 0)) return;
  const a = (Math.random() - 0.5) * 2 * spread;
  const ca = Math.cos(a), sa = Math.sin(a);
  const nx = out.x * ca - out.z * sa;
  const nz = out.x * sa + out.z * ca;
  out.x = nx;
  out.z = nz;
  out.y += (Math.random() - 0.5) * spread;
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= l; out.y /= l; out.z /= l;
}
