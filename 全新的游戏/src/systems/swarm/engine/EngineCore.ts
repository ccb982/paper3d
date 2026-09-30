// ============================================================
// engine/EngineCore.ts —— 引擎相位 tick（重写 P3；用户定）
// ============================================================
// 固定相位（一处顺序，禁靠调用顺序隐式耦合）：
//   perceive → situation → decide(单源) → write → debug
// 本文件是**调度骨架**：各管理器/校验链/发令器由外部注入并接线；
// 引擎本身不含策略（策略在管理器），也不直接发令（只经 OrderWriter，G1）。
// 纯调度（时间从参数传入）→ 可独立自检。
// ============================================================

export interface EnginePorts {
  /** ① 感知：刷新 Positions / 接收队长汇报（唯一接收器 SquadManager.report） */
  perceive(now: number): void;
  /** ② 事态：环上下限 / 防区安全度 / 复合选择依据 */
  situation(now: number): void;
  /** ③ 决策（单源）：四兵种目标分配 / 保护关系 / 干预链 */
  decide(now: number): void;
  /** ④ 下发：只经 OrderWriter（G1） */
  write(now: number): void;
  /** ⑤ 调试：探针/UI 快照 */
  debug(now: number): void;
}

export class EngineCore {
  private acc = 0;
  /** 引擎节拍（Hz；决策拍，默认 2） */
  hz = 2;
  /** 探针契约（G9） */
  readonly dbg = { ticks: 0, hz: 2, last: '' };

  constructor(private readonly ports: EnginePorts) {}

  /** 每帧调用（dt 实秒）；按节拍跑固定相位 */
  tick(dt: number, now: number): void {
    this.acc += dt;
    const step = 1 / this.hz;
    if (this.acc < step) return;
    this.acc %= step;
    this.ports.perceive(now);
    this.ports.situation(now);
    this.ports.decide(now);
    this.ports.write(now);
    this.ports.debug(now);
    this.dbg.ticks++;
    this.dbg.last = `t#${this.dbg.ticks}@${now.toFixed(1)}`;
  }

  setHz(hz: number): void {
    this.hz = hz > 0 ? hz : 1;
    this.dbg.hz = this.hz;
  }
}
