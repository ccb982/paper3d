/**
 * lumbarPolicy.ts —— ★ 腰椎二轴参数（伺服层 · 可训练对象，用户定调 2026-10）
 *
 * 腰椎 = 两个轴：S（矢状）/ L（侧向）。每轴 = **承重主项**（经验证的伺服通道）
 * + **自身姿态微调**（读自己的倾角/角速度 = 自身动量；与推的方向/大小无关）：
 *   · 轴S 主项：qX 幅度预算（spineGainFwd/Back、spineFwd/BackCap、bendHipCap、
 *     bendDeadNormal/Danger、bendRiskMargin）
 *     微调：−(sagAttKp·pitch + sagAttKd·pitchRate)，死区 sagDead
 *   · 轴L 主项：承重脚相对误差（postureGainHip/Spine）
 *     微调：−(latAttKp·roll + latAttKd·rollRate)
 * 训练网页（train.html / src/train.ts）对参数做 RL 式迭代；主页面自 localStorage 加载。
 */

export interface LumbarParams {
  /** 轴S：自身姿态微调增益（俯仰角） */
  sagAttKp: number;
  /** 轴S：自身姿态微调增益（俯仰角速度=动量） */
  sagAttKd: number;
  /** 轴S：微调死区（|att| 小于它不出力） */
  sagDead: number;
  /** 轴L：自身姿态微调增益（滚转角） */
  latAttKp: number;
  /** 轴L：自身姿态微调增益（滚转角速度=动量） */
  latAttKd: number;
  /** 轴S 主项：qX>0（需向前修）时的脊柱前弯增益 */
  spineGainFwd: number;
  /** 轴S 主项：qX<0 时的脊柱后弯增益 */
  spineGainBack: number;
  /** 轴S 主项：脊柱前弯上限（rad/节） */
  spineFwdCap: number;
  /** 轴S 主项：脊柱后弯上限（rad/节；后弯极强，必须限幅） */
  spineBackCap: number;
  /** 轴S 主项：髋力矩上限（N·m） */
  bendHipCap: number;
  /** 轴S 主项：正常 qX 死区 */
  bendDeadNormal: number;
  /** 轴S 主项：危险（XCoM 接近边界）时 qX 死区（早介入） */
  bendDeadDanger: number;
  /** 轴S 主项：判"危险"的 XCoM 余量阈值（m） */
  bendRiskMargin: number;
  /** 轴L 主项：承重脚相对误差 → 髋外展增益 */
  postureGainHip: number;
  /** 轴L 主项：承重脚相对误差 → 脊柱侧折增益 */
  postureGainSpine: number;
}

export const DEFAULT_LUMBAR: LumbarParams = {
  sagAttKp: 0.5,
  sagAttKd: 0.1,
  sagDead: 0.03,
  latAttKp: 0.5,
  latAttKd: 0.1,
  spineGainFwd: 1.0,
  spineGainBack: 1.0,
  spineFwdCap: 0.08,
  spineBackCap: 0.10,
  bendHipCap: 60,
  bendDeadNormal: 0.06,
  bendDeadDanger: 0.035,
  bendRiskMargin: 0.035,
  postureGainHip: 1.0,
  postureGainSpine: 0.5,
};

/** 各参数的搜索上下界 */
export const LUMBAR_BOUNDS: Record<keyof LumbarParams, [number, number]> = {
  sagAttKp: [0.0, 3.0],
  sagAttKd: [0.0, 0.8],
  sagDead: [0.005, 0.08],
  latAttKp: [0.0, 3.0],
  latAttKd: [0.0, 0.8],
  spineGainFwd: [0.2, 2.5],
  spineGainBack: [0.2, 2.5],
  spineFwdCap: [0.03, 0.14],
  spineBackCap: [0.02, 0.12],
  bendHipCap: [20, 90],
  bendDeadNormal: [0.03, 0.10],
  bendDeadDanger: [0.015, 0.06],
  bendRiskMargin: [0.005, 0.08],
  postureGainHip: [0.3, 2.2],
  postureGainSpine: [0.1, 1.5],
};

export const LUMBAR_KEY = 'stickman.servo.lumbar.v4';   // v4：拒收含抖动信息的旧结果（硬门之前的）

export interface LumbarMeta {
  fit: number;
  iter: number;
  time: string;
  note?: string;
  /** 保存时的挺腰 jitter（HF）；>150 的结果在加载时会被拒收（保险） */
  hp?: number;
}

/** 把参数写入 BalanceOptions 结构（主页面/训练页共用） */
export function applyLumbar(opt: object, p: LumbarParams): void {
  const o = opt as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_LUMBAR) as (keyof LumbarParams)[]) {
    o[k] = p[k];
  }
}

/** 从 BalanceOptions 读回（训练页的起点种子） */
export function readLumbar(opt: object): LumbarParams {
  const o = opt as Record<string, unknown>;
  const out = { ...DEFAULT_LUMBAR };
  for (const k of Object.keys(DEFAULT_LUMBAR) as (keyof LumbarParams)[]) {
    const v = o[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = v;
  }
  return out;
}

/** 读训练结果（无/损坏 → null） */
export function loadLumbar(): { p: LumbarParams; meta: LumbarMeta } | null {
  try {
    const raw = localStorage.getItem(LUMBAR_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { p?: Partial<LumbarParams>; meta?: LumbarMeta };
    if (!j.p) return null;
    const p = { ...DEFAULT_LUMBAR };
    let ok = 0;
    for (const k of Object.keys(DEFAULT_LUMBAR) as (keyof LumbarParams)[]) {
      const v = j.p[k];
      if (typeof v === 'number' && isFinite(v)) { p[k] = v; ok++; }
    }
    if (ok < 8) return null;
    const meta = j.meta ?? { fit: 0, iter: 0, time: '' };
    // ★ 保险：记录过挺腰 HF 且超门（>150）的结果拒收（硬门之前可能存在抖参数）
    if (typeof meta.hp === 'number' && meta.hp > 150) return null;
    return { p, meta };
  } catch {
    return null;
  }
}

/** 保存训练结果（训练页在每次刷新最优时调用） */
export function saveLumbar(p: LumbarParams, meta: LumbarMeta): boolean {
  try {
    localStorage.setItem(LUMBAR_KEY, JSON.stringify({ p, meta }));
    return true;
  } catch {
    return false;
  }
}

export function clearLumbar(): void {
  try {
    localStorage.removeItem(LUMBAR_KEY);
  } catch {
    /* ignore */
  }
}
