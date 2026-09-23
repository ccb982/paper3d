// ============================================================
// FrameState —— 动画管线（写）与渲染管线（读）的衔接层
// ============================================================
// 每实体一份，动画管线每帧写入，渲染管线只读。
// lodLevel 由渲染侧 LODManager 评估后下发（P7 启用）。

export interface FrameState {
  /** 当前帧索引（动画管线每帧写入） */
  frameIndex: number;
  /** 朝向（帧组前缀，如 "前"/"后"，与 anims.json 的 facing 表一致） */
  facing: string;
  /** 左右反转（渲染层应用 quad.scale.x = ±1） */
  flipX: boolean;
  /** 上下反转（预留） */
  flipY: boolean;
  /** LOD 等级 0/1/2（渲染侧下发，P7 启用；0=全帧 1=减帧 2=单帧） */
  lodLevel: number;
}

export function createFrameState(initial?: Partial<FrameState>): FrameState {
  return {
    frameIndex: 0,
    facing: '前',
    flipX: false,
    flipY: false,
    lodLevel: 0,
    ...initial,
  };
}
