/** 上身命令层空壳：隔离阶段只占位，不写执行器。 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';

export function upperBodyCommand(_w: World, _st: CS): void {
  // 隔离阶段：先确认没有其他 spine/neck 写手，再填控制律。
}
