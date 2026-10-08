/**
 * ══════════════════════════════════════════════════════════════════
 * ★★★ **实验室配置的单一真源**（2026-10-03）
 * ══════════════════════════════════════════════════════════════════
 *
 * 存在的理由 —— 网页与离屏探针此前是**两个不同的东西**：
 *
 *   · 网页（`src/main.ts`）只跑 **ES 神经网络的输出**。`balanceHold` /
 *     `stepSystem` 那套平衡维持系统**只被 `tools/*.ts` 引用**，
 *     网页上根本没有它 ⇒ 你在网页上调平衡维持系统，网页显示的却是
 *     另一个控制器的结果。
 *   · 网页相位滑块是**二值**的（`hud.ts`: `v<0.5?'walk':'fight'`），
 *     **`stand` 模式在 UI 上不可达**，而 `stand` 才是平衡的验收口径。
 *   · 网页启动会读 localStorage 存档；旧适应度/旧观测下训出的基因组会被
 *     静默恢复，于是网页跑的是历史遗留策略。
 *
 * ⇒ 本文件把「跑什么」收敛成一份 `LabState`，网页和探针都从这里取，
 *   并且提供一个**可肉眼比对的指纹** `labHash()`：
 *   网页状态栏显示它，探针也打印它。指纹不同 ⇒ 两边配置漂移了，当场可见。
 */

/** ★ 配置版本。** 任何影响动力学的改动都要动它 —— 目的是让旧存档自动作废。 */
export const LAB_VERSION = 'lab/2026-10-03-r1';

/** 谁在驱动关节 */
export type Driver =
  /**
   * 手写控制器 = `Controller`（平衡系统 + 迈步系统 + `gaitState` 相位机）。
   *
   * ⚠⚠ **名字是历史遗留，与实现已脱节**：
   *   · 它曾经指 `core/teacher.ts` 的 `makeTeacherSession`（"教师手写策略"），
   *     那个文件已随重构删除；
   *   · 现在 `main.ts` 的 `resetSession()` 建的是 **`new Controller(...)`**，
   *     走的是与探针完全相同的那套重构后代码；
   *   · 但 `'teacher'` 这个**取值本身不能改** —— 它出现在用户可见的 URL
   *     （`?driver=teacher`）与 localStorage 里，改名会废掉已保存的链接。
   * ⇒ 保留 wire 值、改正文档。真正描述实现的名字是「手写控制器 / Controller」。
   *
   * ★ 2026-10-04：取值 `'brain'` **已删除**（ES 驱动路径整体移除，`Sim` 只剩
   *   一个驱动者 `Controller`）⇒ `Driver` 现在是单取值类型。
   */
  | 'teacher';

export type LabMode = 'walk' | 'fight' | 'stand';

export interface LabState {
  /** 训练/评估模式。★ `stand` 才是平衡的验收口径（`ts.single = 恰好一脚着地`） */
  mode: LabMode;
  /** 驱动源。★ 调平衡维持系统时必须选 `teacher`，否则网页上看的是大脑不是它 */
  driver: Driver;
  /** 单腿模式：强制该腿为唯一支撑腿、不换脚（解耦「站稳」与「迈步」） */
  startBearer: 'l' | 'r';
  /** 单腿模式下摆动腿的保持高度（m） */
  liftHold: number;
  /** 单回合时长（s） */
  dur: number;
  /**
   * 足底（踝关节）是否存在。**默认 true**（用户 2026-10-04：「一直打开就行」）。
   *
   * 不做按钮 —— 骨架在 `boot()` 里只构建一次（关节 12→14 会改变网络输出维度），
   * 开关只能靠改 URL 重载，那不值得一个按钮。保留 `?ankle=0` 供 A/B 对照。
   */
  ankle: boolean;
}

export const DEFAULT_LAB: LabState = {
  // ★ 默认改成 stand：当前阶段是"调平衡维持系统"，不是走路。
  //   （此前是 walk，导致网页一打开就在跑走路适应度，显示的东西与调平衡无关。）
  mode: 'stand',
  driver: 'teacher',
  startBearer: 'l',
  liftHold: 0.25,
  dur: 8,
  // ★ 默认**开**（用户 2026-10-04：「不需要开关，一直打开就行」）。
  //   `?ankle=0` 仍可关掉做 A/B 对照。
  ankle: true,
};

/**
 * 配置指纹 —— 网页状态栏与每个探针都打印它，用来**肉眼核对两边是否同源**。
 * 刻意不用 crypto/random：必须是纯函数、跨 node 与浏览器逐字符一致。
 */
export function labHash(s: LabState): string {
  return [
    LAB_VERSION,
    `mode=${s.mode}`,
    `driver=${s.driver}`,
    `startBearer=${s.startBearer}`,
    `liftHold=${s.liftHold.toFixed(3)}`,
    `dur=${s.dur.toFixed(2)}`,
    `ankle=${s.ankle ? 1 : 0}`,
  ].join(' | ');
}

/** 把 LabState 归一成 url 里的查询串，便于「网页 = 探针」互相跳转/复现 */
export function labToQuery(s: LabState): string {
  return new URLSearchParams({
    mode: s.mode, driver: s.driver,
    sl: s.startBearer, lift: String(s.liftHold), dur: String(s.dur),
    ankle: s.ankle ? '1' : '0',
  }).toString();
}

export function labFromQuery(q: string): LabState | null {
  try {
    const u = new URLSearchParams(q);
    const mode = u.get('mode');
    // ⚠ **缺省项从 `DEFAULT_LAB` 补，只有"给了但非法"才拒绝整份。**
    //   原来 mode/driver 任一缺失就 `return null` ⇒ 网页从裸页打开时
    //   点一下「踝关节」按钮，URL 变成 `?ankle=1`（没有 mode/driver）
    //   ⇒ 整份被丢弃 ⇒ `state.ankle` 保持默认 false
    //   ⇒ **按钮点了永远显示"关"**（用户 2026-10-04 亲见）。
    if (mode !== null && mode !== 'walk' && mode !== 'fight' && mode !== 'stand') return null;
    const driver = u.get('driver');
    if (driver !== null && driver !== 'brain' && driver !== 'teacher') return null;
    const sl = u.get('sl');
    const lift = Number(u.get('lift'));
    const dur = Number(u.get('dur'));
    const ankle = u.get('ankle');
    return {
      mode: (mode ?? DEFAULT_LAB.mode) as LabMode,
      driver: (driver ?? DEFAULT_LAB.driver) as Driver,
      startBearer: sl === 'r' ? 'r' : 'l',   // `sl` 只取 l/r（默认 l）
      liftHold: Number.isFinite(lift) && lift > 0 ? lift : DEFAULT_LAB.liftHold,
      dur: Number.isFinite(dur) && dur > 0 ? dur : DEFAULT_LAB.dur,
      ankle: ankle === null ? DEFAULT_LAB.ankle : (ankle === '1' || ankle === 'true'),
    };
  } catch { return null; }
}