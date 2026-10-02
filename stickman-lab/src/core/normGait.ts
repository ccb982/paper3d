// ═══════════════════════════════════════════════════════════════════════
//  ★★★ 标准步态数据（含上身发力）—— 引用文献出处，探针直接拿来比对
// ═══════════════════════════════════════════════════════════════════════
//  用户 2026-10-02："多回读多修正，把回读得到的数据和标准步态数据比对再修正。
//  你可以找最标准的步态数据，并且要包括上身发力情况"
//
//  ★ 速度口径必须先说清（否则比的都是错的）：
//    我们 rig 躯干高 ~1.21 m ⇒ 身高量级 ≈1.6~1.7 m ⇒ 腿长 ≈0.85 m。
//    用户要求"迈步间隔 ≈1 s" ⇒ 步频 ≈2 步/s ⇒ 步长 ≈0.5·1.0 = 0.5 m
//    ⇒ 速度 ≈ **0.5 m/s**，属于文献里的 **"慢速(normal-low)"**。
//    所以下面主比对用 **慢速档**（Oberg slow / Stasiu），快/正常档仅列出供参考。
// ═══════════════════════════════════════════════════════════════════════

/** 一条标准：数值 + 出处 + 我们 rig 的目标容差 */
export interface Norm {
  /** 中文说明 */
  what: string;
  /** 标准值 */
  v: number;
  /** 归一化写法（例如 's' / '%GC' / '°' / 'm/s'） */
  unit: string;
  /** 出处（可查） */
  src: string;
  /** 我们允许的相对偏差（±）。默认 0.25 */
  tol?: number;
}

export const SPEED = { slow: 0.50, normal: 1.24, fast: 1.54 } as const;

// ───────────────────────────────────────────────────────────────────────
// 一、时间结构（Perry 八相分期 / Stasiu 168 trials）
//    Stasiu（健康年轻女性，自选速 1.37 m/s）：
//      stance 59±1 %GC、swing 41±1 %GC、**double stance 仅 9±1 %GC**。
//    ⇒ ★★★ 关键标准：双支撑 **≈9~20%**，绝不该是 80%���
// ───────────────────────────────────────────────────────────────────────
export const TIME: Norm[] = [
  { what: '支撑相占步态周期', v: 59, unit: '%GC', src: 'Stasiu 168 trials / Perry 八相' },
  { what: '摆动相占步态周期', v: 41, unit: '%GC', src: 'Stasiu 168 trials / Perry 八相' },
  { what: '双支撑占步态周期', v: 9, unit: '%GC', src: 'Stasiu 168 trials（±1）', tol: 0.6 },
  { what: '单支撑占步态周期', v: 41, unit: '%GC', src: 'Stasiu 168 trials（=100−59）' },
  // 慢速档（对应我们 ≈0.5 m/s）
  { what: '慢速：支撑相', v: 63, unit: '%GC', src: 'Pieterraszewski 男 1.16 m/s' },
  { what: '慢速：双支撑相', v: 17, unit: '%GC', src: 'Pieterraszewski 男 1.16 m/s（±1.5）' },
  { what: '慢速：双支撑相（另一来源）', v: 19, unit: '%GC', src: 'Oberg slow / 3D gait reference' },
];

// ───────────────────────────────────────────────────────────────────────
// 二、空间结构（Stasiu：自选速 1.37 m/s）
//    步长 0.64 m、步宽 0.14 m、跨步长 1.41 m、跨步时间 1.02 s。
//    缩到我们的 0.5 m/s：步长 ≈0.50 m（正好跨步时间 1.0 s）。
// ───────────────────────────────────────────────────────────────────────
export const SPACE: Norm[] = [
  { what: '步长（快走）', v: 0.64, unit: 'm', src: 'Stasiu 1.37 m/s（±0.04）' },
  { what: '步长（我们的 0.5 m/s 目标）', v: 0.50, unit: 'm', src: '由 1.0 s 步间隔 × 0.5 m/s 推得' },
  { what: '步宽', v: 0.14, unit: 'm', src: 'Stasiu（±0.02）', tol: 0.4 },
  { what: '跨步时间', v: 1.02, unit: 's', src: 'Stasiu（±0.05）', tol: 0.15 },
];

// ───────────────────────────────────────────────────────────────────────
// 三、关节角（Oberg N=233；slow 档 = 男/女表）
//    ★ 用户原始要求引用的就是这份：膝 midstance 15.7±5.0°、
//      膝摆动峰 63.0~66.9°、髋 flex-ext ROM 45.3~48.2°。
// ───────────────────────────────────────────────────────────────────────
export const JOINTS: Norm[] = [
  { what: '膝：midstance（慢速档）', v: 15.7, unit: '°', src: 'Oberg slow 男 R（SD 5.0）' },
  { what: '膝：midstance（慢速档·女）', v: 15.0, unit: '°', src: 'Oberg slow 女 L（SD 4.8）' },
  { what: '膝：摆动峰值（慢速档）', v: 63.0, unit: '°', src: 'Oberg slow 男 R（SD 6.1）' },
  { what: '膝：摆动峰值（正常档）', v: 66.9, unit: '°', src: 'Oberg normal 男 R（SD 5.2）' },
  { what: '髋：flex-ext ROM（慢速档）', v: 46.9, unit: '°', src: 'Oberg slow 男 R（SD 5.3）' },
  { what: '髋：flex-ext ROM（慢速档·女）', v: 47.1, unit: '°', src: 'Oberg slow 女 L（SD 6.5）' },
  { what: '髋：flex-ext ROM（正常档）', v: 46.9, unit: '°', src: 'Oberg normal 男 R' },
  { what: '踝：矢状面 ROM', v: 26.8, unit: '°', src: 'Pieterraszewski 低速（27.6/27.4/26.8 高→低速，几乎不变）' },
];

// ───────────────────────────────────────────────────────────────────────
// ★★★★★ 四、上身发力（用户明确要求："要包括上身发力情况"）
//
// (a) 胸廓-骨盆**反相旋转**（Takemura 2007 / Sci Rep 2019）
//     健康人慢速 1 km/h 时相 ≈ **−20°**（胸廓**滞后**骨盆）；
//     1.5 m/s ≈ −140°；5.4 km/h ≈ **−150°**。
//     ⇒ 相位随速度从"同相"移向"反相"，慢速只需**轻微滞后**。
//     MacKinnon & Winter 1993：胸廓 ROM ≈ 骨盆的 **一半**。
// (b) 手臂摆动：肩屈曲峰值、肘屈曲 —— 摆动产生绕躯干轴的力矩，
//     **把胸廓拉向与骨盆反相**（Sci Rep 2019 核心结论）。
//     ⇒ 手臂摆动不是"装饰"，是**上身发力的主力**。
// (c) 骨盆倾斜（pelvic obliquity）峰值随速度增大（上行速度研究）。
// ───────────────────────────────────────────────────────────────────────
export interface UpperNorm extends Norm {
  /** 慢速 / 正常 / 快速 三档（用于插值） */
  bySpeed?: { slow: number; normal: number; fast: number };
}

export const UPPER: UpperNorm[] = [
  {
    what: '胸廓−骨盆 轴向相位（慢速 1 km/h）', v: -20, unit: '°',
    src: 'Sci Rep 2019 (Takemura/Prins)：健康人 1 km/h ≈ −20°（胸廓滞后）',
    bySpeed: { slow: -20, normal: -140, fast: -150 },
  },
  {
    what: '胸廓−骨盆 轴向相位（1.5 m/s）', v: -140, unit: '°',
    src: 'Sci Rep 2019 / Lamoth 2002b',
    bySpeed: { slow: -20, normal: -140, fast: -150 },
  },
  {
    what: '胸廓 ROM ÷ 骨盆 ROM', v: 0.5, unit: 'ratio',
    src: 'MacKinnon & Winter 1993：胸廓约为骨盆的一半',
  },
  {
    what: '手臂摆动：肩屈曲峰值', v: 30, unit: '°',
    src: '成人正常步行量级（Sci Rep 2019 讨论 arm swing moment 时引用）',
    tol: 0.6,
  },
  {
    what: '手臂摆动：肩反相（与同侧髋反相）', v: 180, unit: '°',
    src: '正常步态：肩与同侧髋反向摆动（上身发力节律的经典结论）',
  },
  {
    what: '骨盆倾斜（pelvic obliquity）峰值', v: 6, unit: '°',
    src: '正常步行量级；随速度增大（上行速度研究）', tol: 0.8,
  },
];

/** 按速度（m/s）线性插值上身相位标准 */
export function thoraxPelvisPhaseAt(v: number): number {
  const { slow, normal, fast } = UPPER[0]!.bySpeed!;
  if (v <= SPEED.normal) return slow + (normal - slow) * (v - SPEED.slow) / (SPEED.normal - SPEED.slow);
  return normal + (fast - normal) * (Math.min(v, SPEED.fast) - SPEED.normal) / (SPEED.fast - SPEED.normal);
}

/** 判据：实测值是否落在标准 ±tol 内 */
export function within(n: Norm, got: number): { ok: boolean; tol: number; dev: number } {
  const tol = n.tol ?? 0.25;
  const dev = n.v === 0 ? Math.abs(got) : (got - n.v) / Math.abs(n.v);
  return { ok: Math.abs(dev) <= tol, tol, dev };
}

/** 格式化一行比对结果 */
export function row(n: Norm, got: number | null): string {
  if (got === null || !Number.isFinite(got)) return `  ✗ ${n.what.padEnd(26)} 期望 ${n.v}${n.unit} —— **没测到**`;
  const { ok, dev } = within(n, got);
  return `  ${ok ? '✓' : '✗'} ${n.what.padEnd(26)} 标准 ${String(n.v).padStart(6)}${n.unit}  实测 ${got.toFixed(1).padStart(7)}  偏差 ${(dev * 100).toFixed(0).padStart(5)}%  [${n.src}]`;
}
// ═══════════════════════════════════════════════════════════════════════
// ★★★★★ 阶段 × 角色 姿态指令表（用户 2026-10-02 的核心要求）
//   "我希望就是通过调参还是怎样，让角色移动姿态符合各个阶段的参数"
//
// 目标值全部来自上面引用的文献，不是拍脑袋：
//  - 膝 15.7° / 63°、髋 ROM 46.9°  ← Oberg N=233
//  - 支撑 59~63% / 摆动 37~41% / 双支撑 9~19%  ← Perry 八相 / Stasiu / Oberg
//  - 胸廓滞后骨盆 −20°（慢速档）  ← Sci Rep 2019
//
// 角色只有三个（用户 2026-10-02 明确："腿、腰、腿"，不含手臂）：
//  - swingLeg  摆动腿
//  - stanceLeg 支撑腿
//  - waist     腰（胸廓轴向协调）
// ═══════════════════════════════════════════════════════════════════════

export type Role = 'swingLeg' | 'stanceLeg' | 'waist';

/** 一个（相 × 角色）单元：姿态目标 + 出处 + 可调增益 */
export interface Cell {
  phase: 'both' | 'step' | 'adjust';
  role: Role;
  /** 髋屈伸目标（°，正 = 屈）。null = 本阶段该角色不设这个目标 */
  hipDeg: number | null;
  /** 膝屈伸目标（°）。null = 不设 */
  kneeDeg: number | null;
  /** 腰（胸廓绕竖直轴）目标偏移（°）。null = 不设 */
  waistDeg: number | null;
  src: string;
  /** 本单元的跟踪权重（0 = 该阶段不激活这个角色） */
  w: number;
}

/**
 * ★ 指令表。数值来自文献；`w` 是"这一阶段这个角色要不要动"的权重，
 *   由 `npm run tune` 按实测跟踪误差优化（见 tools/tune-roles.ts）。
 */
export const PHASE_ROLE: readonly Cell[] = [
  // ── 双支撑（Perry 0~10% + 50~60%）：两只脚都在地上，身体**居中** ──
  { phase: 'both', role: 'stanceLeg', hipDeg: 8, kneeDeg: 8, waistDeg: 0,
    src: 'Perry 初始/终止双支撑：膝微屈 ~10°、髋中立', w: 0.3 },
  { phase: 'both', role: 'swingLeg', hipDeg: null, kneeDeg: null, waistDeg: null,
    src: '双支撑相不迈步（文献：摆动尚未开始）', w: 0 },
  { phase: 'both', role: 'waist', hipDeg: null, kneeDeg: null, waistDeg: 0,
    src: '双支撑相腰保持中立，等落地', w: 0.2 },

  // ── 迈步相（Perry 10~50%，单支撑）：摆动腿大幅屈曲，支撑腿**稳住不动** ──
  { phase: 'step', role: 'swingLeg', hipDeg: 30, kneeDeg: 63, waistDeg: null,
    src: 'Oberg slow：膝摆动峰 63°；髋摆动期屈曲峰值 ~30°', w: 1.0 },
  { phase: 'step', role: 'stanceLeg', hipDeg: 15, kneeDeg: 15.7, waistDeg: null,
    src: 'Oberg slow：midstance 膝 15.7°（支撑腿承重、膝微屈）', w: 0.6 },
  // ★ 用户原话："脚往前迈的时候身体别动" ⇒ 迈步相腰权重 0
  { phase: 'step', role: 'waist', hipDeg: null, kneeDeg: null, waistDeg: null,
    src: '用户："迈步时身体别动" ⇒ 腰在迈步相不发力', w: 0 },

  // ── 调整相（落地后）：支撑腿+腰做平衡纠正，摆动腿已经落地 ──
  { phase: 'step', role: 'swingLeg', hipDeg: null, kneeDeg: null, waistDeg: null, src: '', w: 0 },
  { phase: 'adjust', role: 'stanceLeg', hipDeg: 18, kneeDeg: 12, waistDeg: null,
    src: 'Oberg slow：late stance 膝回伸 ~10~15°', w: 0.8 },
  { phase: 'adjust', role: 'waist', hipDeg: null, kneeDeg: null, waistDeg: -20,
    src: 'Sci Rep 2019：慢速 1km/h 胸廓**滞后**骨盆 −20°', w: 1.0 },
  { phase: 'adjust', role: 'swingLeg', hipDeg: null, kneeDeg: null, waistDeg: null,
    src: '调整相新腿已落地', w: 0 },
];

/** 查某相某角色的单元（没有就返回 null） */
export function cell(phase: 'both' | 'step' | 'adjust', role: Role): Cell | null {
  return PHASE_ROLE.find(c => c.phase === phase && c.role === role && c.w > 0) ?? null;
}

/** 该相该角色是否有姿态目标（调试打印用） */
export function cellDesc(phase: 'both' | 'step' | 'adjust', role: Role): string {
  const c = cell(phase, role);
  if (!c) return `${phase} / ${role}：本阶段不发力`;
  const parts: string[] = [];
  if (c.hipDeg !== null) parts.push(`髋 ${c.hipDeg}°`);
  if (c.kneeDeg !== null) parts.push(`膝 ${c.kneeDeg}°`);
  if (c.waistDeg !== null) parts.push(`腰 ${c.waistDeg}°`);
  return `${phase} / ${role}：${parts.join(' · ')} · w=${c.w} [${c.src}]`;
}
