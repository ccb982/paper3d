/**
 * closedChain.ts —— 蹲姿闭链目标求解器（2026-10-28）
 *
 * ★ 用户定调（2026-10-28）：
 *   「目标位置全用脚的落点算。蹲下的时候脚不可以再动了，
 *     知道脚的位置就能得到膝的位置和髋的位置。」
 *   「大腿的角度不定，但是有个大致的范围。重点看髋。」
 *
 * ── 为什么必须是「位置」而不是「角度」（实测，见 docs/蹲下闭链目标-2026-10-28.md）
 *   蹲姿下 **关节角读数 ≠ 几何姿态**：
 *     静止时 膝z=19.47cm 而 踝z=16.33cm（膝盖外撇 3.15cm），
 *     但 knee_0 读数只有 −0.02° —— rest 姿态自带外八偏置。
 *     读数「归零」≠「几何垂直」。
 *   而脚落点钉死（实测 3s 漂移仅 5~6mm），
 *   于是 **脚落点 + 两段长 ⇒ 膝/髋的世界位置被唯一确定**（闭链）。
 *
 * ── 分层（本模块只解算，不出力）
 *   基础力（pair PD + 被动张力）—— 不动。
 *   回正力（软限位强回正）—— 消费本模块给出的目标角。
 *
 * ── 标定（tools/_tmp-fullcalib.ts，物理级绕轴扰动，cm/deg）
 *
 *   dof      |  膝x     膝z    |  髋x     髋z    |  踝x     踝z    |
 *   hip_l/0  | -0.057   0.155  |  0.000   0.000  | -0.029  -0.498  |
 *   hip_l/1  |  0.102  -0.711  |  0.000   0.000  |  0.054  -0.707  |
 *   hip_l/2  |  0.186  -0.000  |  0.000   0.000  |  0.765  -0.000  |
 *   knee_l/0 |  0.000   0.000  |  0.000   0.000  | -0.050   0.144  |
 *   knee_l/1 |  0.000   0.000  |  0.000   0.000  | -0.094   0.631  |
 *   knee_l/2 |  0.000   0.000  |  0.000   0.000  |  0.572   0.089  |
 *   foot_l/0 |  0.000   0.000  |  0.000   0.000  | -0.000  -0.001  |
 *
 *   两条硬结论：
 *   1. **髋锚点不动**（髋z/髋x 恒 0）——髋的位置由**骨盆**决定，不由腿关节决定。
 *      「髋水平」= 大腿额向不偏（髋z−膝z = 0），主要由 **hip_l/1（扭转轴）** 承担
 *      （0.711 cm/deg），而 hip_l/0 只有 −0.155 ⇒ **单靠 hip_0 拉不动髋水平**。
 *   2. **脚踝三轴对膝/髋全无影响**（全 0）——脚踝只影响踝锚点。
 *
 * ── 求解结构（每帧）
 *   额状（axis 0/1，重点看髋）：残差 = [Δ(膝z−踝z), Δ(髋z−膝z)]
 *                              未知量 = hip_0, hip_1, knee_0, knee_1, knee_2
 *   矢状（axis 2）：残差 = [Δ(膝x−踝x)]（胫骨在矢状面竖直）
 *                  未知量 = hip_2, knee_2
 *   **髋的矢状位置不约束**——大腿角度不定，只在范围内（由软限位负责）。
 */
import type { Body } from '../body';

/** 世界系位置（米）。约定：+X 前，+Y 上，+Z 侧向 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface ClosedChainSide {
  side: 'l' | 'r';
  /** 踝锚点（脚落点基准）——捕获时固定 */
  ankle: V3;
  /** 段长（米） */
  shinLen: number;
  thighLen: number;
  /** 目标：膝 z = 踝 z（膝盖竖直）；膝 x = 踝 x（胫骨矢状竖直） */
  kneeTarget: V3;
  /** 目标：髋 z = 膝 z（大腿额向不偏）；髋 x 自由（大腿矢状角不定） */
  hipTarget: V3;
  /** 目标关节角（dofIndex → rad） */
  ang: Map<number, number>;
  /** 位置残差（米）：[膝z−踝z, 髋z−膝z, 膝x−踝x] */
  residual: number[];
  /** 解出的角度修正（deg）：[hip_0, hip_1, knee_0, knee_1, knee_2, hip_2] */
  delta: number[];
}

export interface ClosedChainTarget {
  l: ClosedChainSide;
  r: ClosedChainSide;
  /**
   * ★ 骨盆（髋锚点）位置目标 —— z = 双脚落点中点 z。
   *
   * 用户设计（2026-10-28）：'脚发力传给髋，把髋拉水平'。
   * 实测（tools/_tmp-fullcalib.ts）：**髋锚点对所有腿关节的响应恒为 0**
   *   （它是骨盆上的点，腿关节转不动它）⇒ 骨盆只被**地面反力**推动。
   *   所以「髋水平」不能靠腿关节的角度 PD 达成，
   *   必须走：髋力矩 → 传到脚 → CoP 偏移 → 地面反力推骨盆。
   *   ⇒ 本字段是**位置目标**（不是角度），由髋策略写手消费。
   *
   * 论文依据（Mirshams Shahshahani & Ashton-Miller 2020, PLoS One 15(11):e0242454）：
   *   'hip strategy' = 髋产生瞬时剪切力于支撑脚 → 经地面反力影响 COM。
   *   'COP 不能移出 BOS' ⇒ 髋策略的可用权限由 CoP 侧向余量决定，非髋 τmax。
   */
  pelvisZTarget: number;
  /** 当前骨盆 z（髋锚点平均，捕获时） */
  pelvisZ: number;
  /** 骨盆侧偏残差（米，正=偏 +z 侧） */
  pelvisResidual: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const anchorOf = (body: Body, jointName: string, axis: number): V3 | null => {
  const i = body.dofByName(jointName, axis);
  if (i < 0) return null;
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};

const dist = (a: V3, b: V3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

/** 关节锚点的宿主刚体 = 该关节的 parent 侧刚体（锚点钉在父体上） */
const anchorHostBody = (body: Body, jointName: string): number => {
  const j = body.sk.joints.find((x) => x.name === jointName);
  if (!j) return -1;
  return body.indexByKey.get(j.parentKey) ?? -1;
};

/** 点 P 在关节 J 转动时是否随动（宿主刚体 ∈ J 的子树） */
const movesWith = (body: Body, jointIdx: number, hostBody: number): boolean => {
  if (hostBody < 0) return false;
  const sub = body.subtree[jointIdx];
  return sub ? sub.includes(hostBody) : false;
};

/**
 * 捕获闭链目标（一次性）。
 * 必须在**脚落点已钉死、姿势已成形**之后调用（法庭释放瞬间 / 起立交接点）。
 *
 * 目标构造（全部从脚落点推）：
 *   膝盖竖直：K*_z = 踝_z（额状）、K*_x = 踝_x（矢状，胫骨竖直）
 *   髋水平：  H*_z = K*_z（大腿额向不偏）
 *   大腿矢状角：自由（H*_x 不约束）——用户：'大腿的角度不定，但有个大致范围'
 */
export function captureClosedChainTarget(body: Body): ClosedChainTarget | null {
  const make = (side: 'l' | 'r'): ClosedChainSide | null => {
    const ankle = anchorOf(body, `foot_${side}`, 2);
    const knee = anchorOf(body, `knee_${side}`, 2);
    const hip = anchorOf(body, `hip_${side}`, 2);
    if (!ankle || !knee || !hip) return null;
    const sl = dist(ankle, knee);
    const tl = dist(knee, hip);
    if (sl < 0.05 || tl < 0.05) return null;
    return {
      side,
      ankle,
      shinLen: sl,
      thighLen: tl,
      kneeTarget: { x: ankle.x, y: knee.y, z: ankle.z },
      hipTarget: { x: hip.x, y: hip.y, z: ankle.z },
      ang: new Map<number, number>(),
      residual: [0, 0, 0],
      delta: [0, 0, 0, 0, 0, 0],
    };
  };
  const l = make('l');
  const r = make('r');
  if (!l || !r) return null;
  // ★ 骨盆位置目标：z = 双脚落点中点 z（脚落点钉死 ⇒ 目标唯一确定）
  const pelvisZTarget = (l.ankle.z + r.ankle.z) / 2;
  const pelvisZ = (l.hipTarget.z + r.hipTarget.z) / 2;
  const t: ClosedChainTarget = {
    l,
    r,
    pelvisZTarget,
    pelvisZ,
    pelvisResidual: pelvisZTarget - pelvisZ,
  };
  solveClosedChainAngles(body, t);
  return t;
}

/**
 * ∂(点 P)/∂θ [m/rad]，绕关节世界轴转动；P 不随动则返回 0。
 */
const jacobian = (
  body: Body, jointName: string, axis: number, point: V3, hostBody: number,
): [number, number, number] => {
  const i = body.dofByName(jointName, axis);
  if (i < 0) return [0, 0, 0];
  const d = body.dofs[i]!;
  const ji = body.sk.joints.findIndex((x) => x.name === jointName);
  if (ji < 0 || !movesWith(body, ji, hostBody)) return [0, 0, 0];
  const a = d.axisWorld;
  const p = d.anchorWorld;
  const rx = point.x - p[0]!, ry = point.y - p[1]!, rz = point.z - p[2]!;
  return [
    a[1]! * rz - a[2]! * ry,
    a[2]! * rx - a[0]! * rz,
    a[0]! * ry - a[1]! * rx,
  ];
};

/** 对称正定小系统求解（高斯消元 + 部分主元） */
function solveSym(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row) => row.slice());
  const x = b.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-14) return null;
    if (piv !== col) {
      const t = M[piv]!; M[piv] = M[col]!; M[col] = t;
      const tb = x[piv]!; x[piv] = x[col]!; x[col] = tb;
    }
    const dd = M[col]![col]!;
    for (let j = col; j < n; j++) M[col]![j] = M[col]![j]! / dd;
    x[col] = x[col]! / dd;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (f === 0) continue;
      for (let j = col; j < n; j++) M[r]![j] = M[r]![j]! - f * M[col]![j]!;
      x[r] = x[r]! - f * x[col]!;
    }
  }
  return x;
}

/** 阻尼最小范数最小二乘：解 (JᵀJ + λI)·Δθ = Jᵀr */
function leastNorm(J: number[][], r: number[], lam = 1e-9): number[] | null {
  const N = J[0]?.length ?? 0;
  if (N === 0) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < N; i++) {
    A.push(new Array<number>(N).fill(0));
    let rhs = 0;
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let k = 0; k < r.length; k++) s += J[k]![i]! * J[k]![j]!;
      A[i]![j] = s;
    }
    for (let k = 0; k < r.length; k++) rhs += J[k]![i]! * r[k]!;
    A[i]![i] = A[i]![i]! + lam;
    b.push(rhs);
  }
  return solveSym(A, b);
}

/**
 * 每帧反解：位置残差 → 关节角修正 → 目标角。
 *
 * 分两个独立子问题（跨平面混解会打架——踝 roll 轴在世界系偏离竖直 29°）：
 *   额状（axis 0/1，重点看髋）：
 *     残差 = [K*_z − K_z − (A*_z − A_z),  H*_z − H_z − (K*_z − K_z)]
 *          即 [Δ(膝z−踝z), Δ(髋z−膝z)]
 *     未知量 = hip_0, hip_1, knee_0, knee_1
 *   矢状（axis 2）：
 *     残差 = [K*_x − K_x − (A*_x − A_x)]（Δ(膝x−踝x)，胫骨矢状竖直）
 *     未知量 = hip_2, knee_2
 *
 * 髋的矢状位置**不约束**——大腿角度不定，只在范围内（由软限位负责）。
 */
export function solveClosedChainAngles(body: Body, tgt: ClosedChainTarget): void {
  // 骨盆残差每帧更新（骨盆只被地面反力推动 ⇒ 必须在运行时读，不能靠一次性捕获）
  {
    const hl = anchorOf(body, 'hip_l', 2);
    const hr = anchorOf(body, 'hip_r', 2);
    if (hl && hr) {
      tgt.pelvisZ = (hl.z + hr.z) / 2;
      tgt.pelvisResidual = tgt.pelvisZTarget - tgt.pelvisZ;
    }
  }
  for (const sc of [tgt.l, tgt.r]) {
    const sd = sc.side;
    const knee = anchorOf(body, `knee_${sd}`, 2);
    const hip = anchorOf(body, `hip_${sd}`, 2);
    const ankle = anchorOf(body, `foot_${sd}`, 2);
    if (!knee || !hip || !ankle) continue;

    // 残差（米）：相对量（差之差），因为目标本身定义为「踝/膝的相对关系」
    const rKz = (sc.kneeTarget.z - knee.z) - (sc.ankle.z - ankle.z);
    const rHz = (sc.hipTarget.z - hip.z) - (sc.kneeTarget.z - knee.z);
    const rKx = (sc.kneeTarget.x - knee.x) - (sc.ankle.x - ankle.x);
    sc.residual = [rKz, rHz, rKx];

    // 宿主刚体：膝锚宿主=thigh、髋锚宿主=torso(pelvis)、踝锚宿主=shin
    const hostKnee = anchorHostBody(body, `knee_${sd}`);
    const hostHip = anchorHostBody(body, `hip_${sd}`);
    const hostAnkle = anchorHostBody(body, `foot_${sd}`);

    const usable = (jn: string, ax: number): boolean => {
      const i = body.dofByName(jn, ax);
      if (i < 0) return false;
      const d = body.dofs[i]!;
      return !d.preRing && !d.engineMotor;
    };

    // ── 额状：hip_0, hip_1, knee_0, knee_1 ──
    const latDofs: Array<[string, number]> = [['hip', 0], ['hip', 1], ['knee', 0], ['knee', 1]];
    const Jlat: number[][] = [];
    for (const [nm, ax] of latDofs) {
      const jn = `${nm}_${sd}`;
      if (!usable(jn, ax)) { Jlat.push([0, 0]); continue; }
      const gk = jacobian(body, jn, ax, knee, hostKnee);
      const gh = jacobian(body, jn, ax, hip, hostHip);
      const ga = jacobian(body, jn, ax, ankle, hostAnkle);
      // 行1 = ∂(膝z−踝z)，行2 = ∂(髋z−膝z)
      Jlat.push([gk[2]! - ga[2]!, gh[2]! - gk[2]!]);
    }
    const dLat = leastNorm(Jlat, [rKz, rHz]);

    // ── 矢状：hip_2, knee_2 ──
    //   「胫骨矢状竖直」是**软**目标：用户说『大腿的角度不定，但有个大致范围』，
    //   所以矢向修正必须限幅（默认 ±8°），否则会把大腿强行掰到某个固定角（实测需要 +30°）。
    const sagDofs: Array<[string, number]> = [['hip', 2], ['knee', 2]];
    const Jsag: number[][] = [];
    for (const [nm, ax] of sagDofs) {
      const jn = `${nm}_${sd}`;
      if (!usable(jn, ax)) { Jsag.push([0]); continue; }
      const gk = jacobian(body, jn, ax, knee, hostKnee);
      const ga = jacobian(body, jn, ax, ankle, hostAnkle);
      Jsag.push([gk[0]! - ga[0]!]);   // ∂(膝x−踝x)/∂θ
    }
    const dSagRaw = leastNorm(Jsag, [rKx]);
    // 矢向限幅（保持大腿角度在"大致范围"内）
    const SAG_MAX = Math.abs(Number(
      ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}).SQC_CHAIN_SAG_MAX ?? 8,
    )) * Math.PI / 180;
    const dSag = dSagRaw ? dSagRaw.map((v) => clamp(v, -SAG_MAX, SAG_MAX)) : null;

    // ── 写目标角（单次修正限幅 20°，避免一步跨太多） ──
    const MAXD = (20 * Math.PI) / 180;
    const apply = (dofName: string, ax: number, dq: number | undefined): void => {
      if (dq === undefined) return;
      const i = body.dofByName(dofName, ax);
      if (i < 0) return;
      const d = body.dofs[i]!;
      sc.ang.set(i, d.angle + clamp(dq, -MAXD, MAXD));
    };
    apply(`hip_${sd}`, 0, dLat?.[0]);
    apply(`hip_${sd}`, 1, dLat?.[1]);
    apply(`knee_${sd}`, 0, dLat?.[2]);
    apply(`knee_${sd}`, 1, dLat?.[3]);
    apply(`hip_${sd}`, 2, dSag?.[0]);
    apply(`knee_${sd}`, 2, dSag?.[1]);

    sc.delta = [
      (dLat?.[0] ?? 0) * 180 / Math.PI,
      (dLat?.[1] ?? 0) * 180 / Math.PI,
      (dLat?.[2] ?? 0) * 180 / Math.PI,
      (dLat?.[3] ?? 0) * 180 / Math.PI,
      (dSag?.[1] ?? 0) * 180 / Math.PI,
      (dSag?.[0] ?? 0) * 180 / Math.PI,
    ];
  }
}

/** 目标角读取（给回正力层用） */
export function closedChainAngle(tgt: ClosedChainTarget, dofIndex: number): number | undefined {
  return tgt.l.ang.get(dofIndex) ?? tgt.r.ang.get(dofIndex);
}

/**
 * 骨盆侧偏残差（米，正 = 需向 +z 侧推）。
 * 这是「髋水平」的位置误差——**髋锚点动不了，只能靠地面反力推**。
 */
export function closedChainPelvisResidual(tgt: ClosedChainTarget): number {
  return tgt.pelvisResidual;
}

/** 诊断：位置残差（米） */
export function closedChainResidual(tgt: ClosedChainTarget, side: 'l' | 'r'): number[] {
  return (side === 'l' ? tgt.l : tgt.r).residual;
}
