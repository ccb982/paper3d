/**
 * 伺服 · 矢状稳定残留状态
 *
 * ★ 2026-10-16 写手审计：SagittalStab 类已删——§2.635 起 `sag.step` 已让位（调用点全被注释），
 *   类实例、SAGITTAL/SAG_RATE/SAG_RTD 律参数无任何调用者（grep 全仓零引用）。
 *   仅保留交接残余 sagOffset：B 相弯腰终值 → C 相内指数衰减（交叉淡化交接 §2.73），
 *   由 stepPhases 调用（setSagOffset / decaySagOffset）。
 */

let sagOffset = 0;   // ★ 交接残余（B 相弯腰终值；C 相内指数衰减——交叉淡化交接 §2.73）
export function setSagOffset(v: number): void { sagOffset = v; }
export function decaySagOffset(dt: number): void { sagOffset *= Math.exp(-dt / 0.25); }
