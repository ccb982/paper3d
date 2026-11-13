// ============================================================
// src/fx/runtime/FxChannel —— 特效通道契约
// ============================================================
// 每个通道自己持有一组场景对象与实例池，但**生命周期由 FxRuntime 统一驱动**：
//   update 由运行时每帧调用；clear 是"按效果清场"；dispose 是终局释放。
// 新增通道只需实现这三个方法 + 自己的 spawn/kill，不再各自往调用方塞 update 循环。
// ============================================================

import type * as THREE from 'three';

export interface FxChannel {
  /**
   * 每帧推进。
   * @param camera 需要做 billboard / 视向计算的通道使用；不需要的通道可忽略。
   */
  update(dt: number, camera?: THREE.Camera): void;
  /** 清掉正在播的实例（保留池与 GPU 资源，之后还能继续 spawn） */
  clear(): void;
  /** 终局释放（场景对象 + 材质/几何 + 池） */
  dispose(): void;
}
