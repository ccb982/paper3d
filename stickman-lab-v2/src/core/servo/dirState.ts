/** dirState.ts —— 全局方向态（2026-10-15 用户："一个方向需要这个方向的脊柱、腿、盆骨都有一套独立参数"）
 *
 *  每帧由 supportClean（hub）更新一次：侧向/矢状各一个**稳定信号**（CoM 相对支撑脚的低通偏移）
 *  → `dirState.latN / sagN`。全链（supportClean 腿、trunkClean 脊柱+盆骨）按同一方向态选参数集。
 */
import type { ServoRefs } from './supportReg';

export const dirState = {
  latN: true,   // 侧向 N 侧（信号 <0）
  sagN: true,   // 矢状 N 侧
};

let _latLp = 0, _sagLp = 0;
export function dirStateReset(): void {
  _latLp = 0; _sagLp = 0;
  dirState.latN = true; dirState.sagN = true;
}

export function updateDirState(ctx: ServoRefs, side: 'l' | 'r', dt: number): void {
  const fz = ctx.sensors.feet[side === 'l' ? 0 : 1]!.z;
  const latRaw = ctx.sensors.com[2]! - fz;        // CoM 侧向相对支撑脚
  const sagRaw = ctx.sensors.com[0]!;             // CoM 前后
  const a = 1 - Math.exp(-dt / 0.3);
  _latLp += (latRaw - _latLp) * a;
  _sagLp += (sagRaw - _sagLp) * a;
  dirState.latN = _latLp < 0;
  dirState.sagN = _sagLp < 0;
}
