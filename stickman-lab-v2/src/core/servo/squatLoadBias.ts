/** 蹲姿横向修正时的脚底载荷偏置（共享小状态）。
 *
 *  hip/脊柱 roll 修正需要对应脚提供更大法向力；
 *  这里只传一个归一化 bias，具体 CoP 偏移由 ankleVector 执行。
 */
import type { CourtState as CS } from '../court';

const _bias = new WeakMap<CS, number>();

export function setSquatLoadBias(st: CS, v: number): void { _bias.set(st, v); }
export function getSquatLoadBias(st: CS): number { return _bias.get(st) ?? 0; }
export function clearSquatLoadBias(st: CS): void { _bias.delete(st); }
