/**
 * standing.ts —— **站立的唯一判据**（所有探针共用，禁止各自另写一套）
 *
 * ════════════════════════════════════════════════════════════════════════
 * ★ 为什么需要这个文件：同一个"站立时长"这件事，项目里已经栽了**三次**
 *   （2026-10-04/05），每次都是因为把**不同**的东西当成"倒了"：
 *
 *   ① `sim.finished` 在**跑满时长**时也为 true（`finish(false)`），
 *      但它**不等于摔倒**。默认 `duration=6` ⇒ 任何 6s 的读数都是"跑满"，
 *      之前被当成"只能站 6s"报过。
 *   ② `fallReason` 只在 `checkFall()` 里赋值 ⇒ 跑满时它是**空串**。
 *      用 `fallReason !== ''` 判定摔倒是对的；但反过来用
 *      `fallReason === ''` 判定"没倒"会把**超时/异常退出**也算成站立成功。
 *   ③ 探针自己在 `tilt > 25°` 时 `break`，报的却是"倒于 t=?"——
 *      那是**探针的阈值**，不是死亡判定，两者的时刻不同、数量级也不同。
 *
 *   ⇒ 结论：**站立时长必须由一个公用判据给出，且必须区分三种结束**
 *      「摔倒」「跑满」「被外部中断」，并给出导致退化的**第一个量**。
 * ════════════════════════════════════════════════════════════════════════
 */

import type { Sim } from './sim';
import type { Ragdoll } from './ragdoll';
import { newCom, readCom, omegaAt } from './posture';

/** 结束原因（三者互斥，**穷尽**） */
export type StandEnd =
  /** 真的倒了：死亡判定的某一条触发 */
  | 'fell'
  /** 跑满设定时长，全程未触发死亡判定 */
  | 'survived'
  /** 探针主动放弃（时长上限/手动中断）—— **不算成功** */
  | 'aborted'
  /** 仿真本身出问题（未初始化、无 body 等） */
  | 'error';

/** 退化方向：站立失败是哪个自由度先坏 */
export type FailMode = 'none' | 'sagittal' | 'lateral' | 'sink' | 'unknown';

export interface StandSample {
  t: number;
  comY: number;
  comX: number;
  comZ: number;
  xiX: number;
  xiZ: number;
  tiltDeg: number;
  /** 承重腿 */
  support: 'l' | 'r';
  /** 触地刚体名（空 = 腾空） */
  touching: string;
  grounded: number;
}

export interface StandVerdict {
  end: StandEnd;
  /** 真正"站住"的时长（s）。`end==='survived'` 时 = 配置时长 */
  stoodSec: number;
  /** 退化超阈值的时长；未退化 = stoodSec */
  degradedSec: number;
  /** 第一个超标的量出现时刻；没有则 -1 */
  firstDegradedAt: number;
  /** 退化最严重的自由度 */
  failMode: FailMode;
  /** 触发摔倒的那一条（仅 end==='fell'） */
  fallReason: string;
  /** 触发时触地的非脚刚体（仅 crash） */
  hitBody: string;
  /** 退化判据阈值（供诊断回显，避免"换个阈值就换个结论"） */
  th: { comYSink: number; tiltDeg: number; xiDrift: number };
  /** 采样序列 */
  samples: StandSample[];
}

/**
 * 默认退化阈值。
 * ⚠ 全部来自**实测静立噪声**，不是拍的：
 *   · 静立 CoP 噪声底 AP ≈18mm、ML ≈6mm（Nigg 2006）⇒ 漂移阈值 0.06m 是 3 倍余量
 *   · comY 从 0.960 掉到 0.881 判为"下沉"（实测值 -79mm）⇒ 阈值 -40mm
 *   · 倾角：静止时实测 3~6°，>20° 视为已失控
 */
export const STAND_THRESH = { comYSink: 0.040, tiltDeg: 20, xiDrift: 0.060 } as const;

const DEG = 180 / Math.PI;

/**
 * 跑一次站立并给出**唯一**判据下的结论。
 *
 * @param durSec 目标时长。**必须显式给足**（≥20s）——
 *   用默认 `duration=6` 只能验证"没在 6 秒内倒"，那是弱得多的命题。
 * @param th 退化阈值
 * @param maxTilt 探针放弃阈值。**注意**：达到它时 `end='aborted'`，
 *   不是 `'fell'` —— 因为那不是死亡判定说了算。
 */
export function assessStanding(
  sim: Sim, doll: Ragdoll, durSec: number,
  th: typeof STAND_THRESH = STAND_THRESH,
  maxTilt = 25,
  /**
   * 每步之前调用（通常是 `ctrl.step(dt)`）。
   * ★ `Controller.step()` **内部已经**把仲裁结果写进 `sim.doll`
   *   （`setTorqueTargets` + `setHoldMask`，见 controller.ts 第 6 步），
   *   所以这里**不要**再写 `sim.motor.set(...)` —— 那是私有字段、类型报错，
   *   而且**什么都不做**（外层那次调用是无效代码）。
   */
  tick?: (sim: Sim) => void,
): StandVerdict {
  const com = newCom();
  const samples: StandSample[] = [];
  const dt = sim.dt;   // 公开字段（“物理步长（秒）”）
  let firstDegradedAt = -1;
  let failMode: FailMode = 'none';
  let degradedSec = 0;

  const comY0 = ((): number => { readCom(doll, com); return com.y; })();
  const degrade = (s: StandSample): FailMode => {
    // 每一项独立判，返回**最先越界**的那一项（按退化量排序，不是按判据顺序）
    const cands: { m: FailMode; ratio: number }[] = [
      { m: 'sink', ratio: (comY0 - s.comY) / th.comYSink },
      { m: 'unknown', ratio: s.tiltDeg / th.tiltDeg },
      { m: 'sagittal', ratio: Math.abs(s.xiX) / th.xiDrift },
      { m: 'lateral', ratio: Math.abs(s.xiZ) / th.xiDrift },
    ];
    cands.sort((a, b) => b.ratio - a.ratio);
    const worst = cands[0]!;
    return worst.ratio >= 1 ? worst.m : 'none';
  };

  let steps = Math.round(durSec / dt);
  let ended: StandEnd = 'aborted';
  for (let i = 0; i < steps; i++) {
    // ★ 由本函数**独占**推进模拟。探针不许在外面先跑一遍循环再调这里 ——
    //   那样传进来时 `sim.fallen` 已经是 true，本函数第一帧就返回"站立 0.00s"，
    //   与曲线矛盾（实测踩过）。
    tick?.(sim);
    sim.advance(1);
    const t = (i + 1) * dt;
    readCom(doll, com);
    const torso = doll.torso();
    const w = omegaAt(com.y);
    const s: StandSample = {
      t,
      comY: com.y, comX: com.x, comZ: com.z,
      // ξ = com − ẋ/ω（附录 B 的定义），不是 com 本身
      xiX: com.x - com.vx / w,
      xiZ: com.z - com.vz / w,
      tiltDeg: doll.tiltOf(torso) * DEG,
      support: com.z > 0 ? 'l' : 'r',
      touching: doll.groundTouching().join(','),
      grounded: (doll.footGrounded(0) ? 1 : 0) + (doll.footGrounded(1) ? 1 : 0),
    };
    samples.push(s);

    const dm = degrade(s);
    if (dm !== 'none') {
      degradedSec = t;
      if (firstDegradedAt < 0) { firstDegradedAt = t; failMode = dm; }
      else if (dm !== 'unknown' && failMode === 'unknown') failMode = dm;
    }

    // ★ 结束原因的**唯一**判定处，按 sim 自己的状态读，不自己猜：
    if (sim.fallen) { ended = 'fell'; break; }
    if (sim.finished) { ended = 'survived'; break; }   // 跑满，不是倒
    if (s.tiltDeg > maxTilt) { ended = 'aborted'; break; }  // 探针放弃
  }

  const stoodSec = samples.length ? samples[samples.length - 1]!.t : 0;
  return {
    end: ended,
    stoodSec: ended === 'survived' ? durSec : stoodSec,
    degradedSec: firstDegradedAt < 0 ? stoodSec : firstDegradedAt,
    firstDegradedAt,
    failMode: ended === 'survived' && firstDegradedAt < 0 ? 'none' : failMode,
    fallReason: sim.fallReason,
    hitBody: doll.lastHitKey,
    th,
    samples,
  };
}

/** 单行摘要——**探针只准打这一行**，不得自己拼结论 */
export function formatStandVerdict(v: StandVerdict): string {
  const endTxt: Record<StandEnd, string> = {
    fell: '摔倒', survived: '跑满未倒', aborted: '探针中断(非摔倒)', error: '错误',
  };
  const modeTxt: Record<FailMode, string> = {
    none: '无退化', sagittal: '前后向(矢状面)', lateral: '侧向(额状面)',
    sink: '整体下沉', unknown: '仅倾角',
  };
  const base = `结束=${endTxt[v.end]} 站立=${v.stoodSec.toFixed(2)}s `
    + `退化起点=${v.firstDegradedAt < 0 ? '无' : v.firstDegradedAt.toFixed(2) + 's'} `
    + `主导=${modeTxt[v.failMode]}`;
  return v.end === 'fell'
    ? `${base} 死因=[${v.fallReason || '未记录'}]${v.hitBody ? ` 触地=${v.hitBody}` : ''}`
    : base;
}

/**
 * 退化曲线摘要（每隔 `everySec` 秒一行）。
 * ⚠ 只打印**读数**，不打印结论——结论由 formatStandVerdict 统一给。
 */
export function printStandCurve(v: StandVerdict, everySec = 0.5): void {
  const head = '   t/s    comY   comX    comZ      ξx      ξz   倾角° 承重 触地';
  console.log(head);
  let next = 0;
  for (const s of v.samples) {
    if (s.t < next - 1e-9) continue;
    next += everySec;
    console.log(
      `  ${s.t.toFixed(2).padStart(5)} ${s.comY.toFixed(3)} ${s.comX.toFixed(3)}`
      + ` ${s.comZ.toFixed(3).padStart(7)} ${s.xiX.toFixed(3).padStart(7)}`
      + ` ${s.xiZ.toFixed(3).padStart(7)} ${s.tiltDeg.toFixed(1).padStart(6)}`
      + `  ${s.support}   ${(s.touching || '（腾空）').slice(0, 34)}`,
    );
  }
}
