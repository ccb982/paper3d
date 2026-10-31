// ============================================================
// VisitorBodyLike —— 访客身体渲染器统一接口
// ============================================================
// 两套实现共用（实体层 / 舰内 BaseScene 只依赖本接口）：
//   · VisitorBodyRenderer —— 程序化 Q 版小人（球头/豆身/胶囊四肢）
//   · VisitorModelRenderer —— 现成 GLB 模型（Kenney Mini Characters，骨骼动画）

export interface VisitorBodyLike {
  /** 世界位置（脚底锚点） */
  setPosition(x: number, y: number, z?: number): void;
  /** 朝向（弧度；+Z 为正面） */
  setYaw(rad: number): void;
  /** 行进状态（speed = 世界单位/秒；0 = 待机） */
  setLocomotion(moving: boolean, speed: number): void;
  /** 每帧驱动（步态 / 骨骼动画混合） */
  update(dt: number): void;
  dispose(): void;
}
