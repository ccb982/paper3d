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
  /** ES 神经网络（`brainForward`，走 `Sim.controlTick`） */
  | 'brain'
  /** 手写平衡维持 + 迈步（`makeTeacherSession`，走 `teacher.ts`） */
  | 'teacher';

export type LabMode = 'walk' | 'fight' | 'stand';

export interface LabState {
  /** 训练/评估模式。★ `stand` 才是平衡的验收口径（`ts.single = 恰好一脚着地`） */
  mode: LabMode;
  /** 驱动源。★ 调平衡维持系统时必须选 `teacher`，否则网页上看的是大脑不是它 */
  driver: Driver;
  /** 单腿模式：强制该腿为唯一支撑腿、不换脚（解耦「站稳」与「迈步」） */
  singleLeg: 'l' | 'r' | null;
  /** 单腿模式下摆动腿的保持高度（m） */
  liftHold: number;
  /** 单回合时长（s） */
  dur: number;
}

export const DEFAULT_LAB: LabState = {
  // ★ 默认改成 stand：当前阶段是"调平衡维持系统"，不是走路。
  //   （此前是 walk，导致网页一打开就在跑走路适应度，显示的东西与调平衡无关。）
  mode: 'stand',
  driver: 'teacher',
  singleLeg: 'l',
  liftHold: 0.25,
  dur: 8,
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
    `singleLeg=${s.singleLeg ?? '-'}`,
    `liftHold=${s.liftHold.toFixed(3)}`,
    `dur=${s.dur.toFixed(2)}`,
  ].join(' | ');
}

/** 把 LabState 归一成 url 里的查询串，便于「网页 = 探针」互相跳转/复现 */
export function labToQuery(s: LabState): string {
  return new URLSearchParams({
    mode: s.mode, driver: s.driver,
    sl: s.singleLeg ?? '', lift: String(s.liftHold), dur: String(s.dur),
  }).toString();
}

export function labFromQuery(q: string): LabState | null {
  try {
    const u = new URLSearchParams(q);
    const mode = u.get('mode');
    if (mode !== 'walk' && mode !== 'fight' && mode !== 'stand') return null;
    const driver = u.get('driver');
    if (driver !== 'brain' && driver !== 'teacher') return null;
    const sl = u.get('sl');
    const lift = Number(u.get('lift'));
    const dur = Number(u.get('dur'));
    return {
      mode, driver,
      singleLeg: sl === 'l' || sl === 'r' ? sl : null,
      liftHold: Number.isFinite(lift) && lift > 0 ? lift : DEFAULT_LAB.liftHold,
      dur: Number.isFinite(dur) && dur > 0 ? dur : DEFAULT_LAB.dur,
    };
  } catch { return null; }
}