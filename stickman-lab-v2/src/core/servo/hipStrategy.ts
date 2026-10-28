/**
 * hipStrategy.ts —— 蹲姿额状面「髋策略」写手（2026-10-28）
 *
 * ★ 用户设计（2026-10-28）：
 *   「脚发力传给髋，把髋拉水平。这是我的设计。
 *     髋回正的力传到脚上抵消就行。」
 *   「我让你把力全用在髋上，而不是膝上。」
 *
 * ── 论文依据（详见 docs/髋水平回正-论文依据与写手归属-2026-10-28.md）
 *   Mirshams Shahshahani & Ashton-Miller 2020, PLoS One 15(11):e0242454：
 *     · 'hip strategy' = 髋在支撑脚上产生瞬时剪切/压力变化 → 经地面反力影响 COM。
 *     · 'COP 不能移出 BOS' ⇒ 权限由 **CoP 侧向余量**决定，不是髋的 τmax。
 *     · 静态平衡：COM 的地面投影必须与 COP 重合。
 *   Afschrift et al. 2016, J Neurophysiol：
 *     踝/髋策略是**连续谱**；省力权重↑ → 偏踝策略 ⇒ 本写手必须有死区。
 *
 * ── 实测标定（tools/_tmp-level2.ts，物理级，τ=10N·m × 0.35s）
 *
 *   模式            Δroll(cm)  Δshift(cm)  Δ膝L(cm)  Δ膝R(cm)
 *   hip_0 同向 ++      +7.0        +4.1       +7.2      +14.5
 *   hip_0 差动 +−      −0.1        −1.5       −3.0       +3.8   ★两膝同时内收
 *   hip_1 同向 ++      +6.4        −0.3       +3.4      +12.8
 *   hip_1 差动 +−      +2.0        −1.1       −3.0       +9.5
 *
 *   ⇒ **两个目标的驱动方式不同**：
 *     · 髋水平（roll = 髋L.y−髋R.y）→ 需要**同向**髋力矩（hip_0 同向 +7.0 / hip_1 同向 +6.4）
 *     · 膝竖直（膝z−踝z）        → 需要**差动**髋力矩（hip_0 差动：左 −3.0 / 右 +3.8）
 *   ⇒ **膝自己出力几乎无效**（knee_0 同向仅 0.13 cm/(N·m)）→ 符合用户「力全用在髋上」。
 *
 * ── 写手归属（不抢其他回正力写手）
 *   hip_0  ← 本写手**独占**（squatFrontalPassive 的 hip_0 已摘除）
 *   hip_1  ← 本写手**独占**（实测无任何写手占用）
 *   knee_0 / foot_0 / spine / hip_2 / knee_2 ← **不写**
 *   通道：ext / 'active'（与 passive 通道分离 ⇒ 弱耦合而非对拉）
 *   优先级：PRI.reflex（60，低于 pair/action 的基础力）
 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import { propose, PRI } from '../proposalBus';
import { baseState } from './baseTable';
import {
  captureClosedChainTarget, solveClosedChainAngles, closedChainAngleByName,
  type ClosedChainTarget,
} from './closedChain';
import { frontalAxis, torsionAxis, sagittalAxis } from './jointPlane';

/** 脚掌几何常量（与 court.ts 的支撑区计算一致） */
const FOOT_HALF_W = 0.05;    // 脚半宽（m）——court.ts: halfWid = 0.10/2
const FOOT_HALF_L = 0.156 * 1.8 / 2;   // 脚半长（m）——court.ts: halfLen

/** 写手状态（跨帧保留：渐入渐出、残差速率） */
interface HipStrategyState {
  /** 渐入系数 0..1 */
  alpha: number;
  /** 上一帧各残差 */
  resPrev: {
    pelvis: number;
    roll: number;
    kneeL: number;
    kneeR: number;
  };
  /** 上一帧时间 */
  tPrev: number;
}
const _st = new WeakMap<ClosedChainTarget, HipStrategyState>();

/** 闭链目标（捕获一次；脚落点钉死后姿态成形时捕获） */
let _target: ClosedChainTarget | null = null;

/** 供 court.ts 在释放瞬间调用：捕获闭链目标 */
export function captureHipStrategyTarget(w: World): ClosedChainTarget | null {
  _target = captureClosedChainTarget(w.body);
  return _target;
}

/** 供 court.ts / 探针读取当前闭链目标 */
export function hipStrategyTarget(): ClosedChainTarget | null {
  return _target;
}

/** 复位（切状态 / 重置世界时） */
export function hipStrategyReset(): void {
  _target = null;
}

/**
 * 髋策略写手：每帧调用。
 *
 * 流程：
 *   ① 重解闭链目标 → 读三个残差（骨盆偏、髋侧倾、膝竖直×2）
 *   ② 死区判定（小偏差不介入 → 交给踝策略 + 被动刚度）
 *   ③ 渐入渐出（避免阶跃）
 *   ④ 位置残差 → 力矩
 *      · 膝竖直：**差动** hip_0，逐侧闭环（左膝用左髋、右膝用右髋）
 *      · 髋水平：**同向** hip_0 + hip_1（骨盆侧倾靠同向力矩）
 *   ⑤ CoP 侧向预算钳位（论文硬约束：COP 不能移出 BOS）
 *   ⑥ 提案（ext/active 通道，PRI.reflex）
 */
export function squatHipStrategy(w: World, ctl: ControlModule): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  if (String(env.SQC_HIP_STRATEGY ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;

  const tgt = _target;
  if (!tgt) return;

  // ① 重解（残差每帧更新）
  solveClosedChainAngles(w.body, tgt);

  // ── 读残差 ──
  //  骨盆侧移：骨盆平均 z − 双脚中点 z（正 = 偏 +z）
  const pelvisRes = tgt.pelvisResidual;
  //  髋侧倾（roll）：髋L.y − 髋R.y（正 = 左髋高）
  const hl = w.body.dofs[w.body.dofByName('hip_l', 2)]!;
  const hr = w.body.dofs[w.body.dofByName('hip_r', 2)]!;
  const roll = hl.anchorWorld[1]! - hr.anchorWorld[1]!;
  //  膝竖直：膝.z − 踝.z（正 = 膝偏 +z = 外撇），目标 0
  const kneeL = tgt.kneeResidualL;
  const kneeR = tgt.kneeResidualR;

  // ② 死区（任一残差超死区才介入）
  //    默认 1cm：实测扫描（tools/_tmp-tune.ts）——1cm 的 maxShift 最小（2.15cm vs 2cm 的 4.20cm）；
  //    死区放大到 3cm ⇒ 膝/roll 都失控（7.58/5.29）。
  const dead = Math.abs(Number(env.SQC_HS_DEAD ?? 0.01));    // m，默认 1cm
  const deadRoll = Math.abs(Number(env.SQC_HS_DEAD_ROLL ?? 0.01));  // m，默认 1cm
  const active = Math.abs(pelvisRes) >= dead
    || Math.abs(roll) >= deadRoll
    || Math.abs(kneeL) >= dead
    || Math.abs(kneeR) >= dead;

  let st = _st.get(tgt);
  if (!st) {
    st = { alpha: 0, resPrev: { pelvis: pelvisRes, roll, kneeL, kneeR }, tPrev: w.clock };
    _st.set(tgt, st);
  }

  if (!active) {
    // 死区内 → 渐出到 0（不突然撤力）
    st.alpha = Math.max(0, st.alpha - w.dt / Math.max(1e-3, Number(env.SQC_HS_RAMP ?? 0.2)));
    st.resPrev = { pelvis: pelvisRes, roll, kneeL, kneeR };
    st.tPrev = w.clock;
    return;
  }

  // ③ 渐入
  const ramp = Math.max(1e-3, Number(env.SQC_HS_RAMP ?? 0.2));
  st.alpha = Math.min(1, st.alpha + w.dt / ramp);

  // ④ 残差 → 力矩
  const dt = Math.max(1e-4, w.clock - st.tPrev);
  st.tPrev = w.clock;
  const rate = {
    pelvis: (pelvisRes - st.resPrev.pelvis) / dt,
    roll: (roll - st.resPrev.roll) / dt,
    kneeL: (kneeL - st.resPrev.kneeL) / dt,
    kneeR: (kneeR - st.resPrev.kneeR) / dt,
  };
  st.resPrev = { pelvis: pelvisRes, roll, kneeL, kneeR };

  // 增益（按实测闭环扫描选定，tools/_tmp-kscan.ts）
  //   膝竖直 —— 由**膝额状轴**直接出力（用户：'发力的是膝盖和大腿，小腿支撑就行了'）：
  //     残差 = 膝z − 踝z（正 = 外撇），实测正 τ 使偏差减小 ⇒ **同号**
  //     权限：左 1.36 / 右 0.88 cm/(N·m) ⇒ 增益 1/1.36≈74、1/0.88≈114
  //     实测扫描最优：kp 150/220、dead 1cm
  //       max膝 5.26→1.99、maxRoll 4.08→0.79、maxShift 6.43→1.39
  //   骨盆侧移 —— 髋额状轴同向 4.1 cm per 10N·m ⇒ 权限 0.41 ⇒ 增益 245
  //   髋侧倾   —— 髋额状轴同向 7.0 cm per 10N·m ⇒ 权限 0.70 ⇒ 增益 145
  const kpKneeL = Math.abs(Number(env.SQC_HS_KP_KNEE_L ?? 150));
  const kpKneeR = Math.abs(Number(env.SQC_HS_KP_KNEE_R ?? 220));
  const kpPelvis = Math.abs(Number(env.SQC_HS_KP_PELVIS ?? 245));
  // ★ roll 分量默认 0：实测（tools/_tmp-combo.ts）加 roll 会和膝分量打架
  //   膝+pelvis245        max膝=2.18 maxRoll=1.50 maxShift=3.55   ← 最优
  //   膝+pelvis245+roll145 max膝=5.96 maxRoll=1.43 maxShift=1.98
  const kpRoll = Math.abs(Number(env.SQC_HS_KP_ROLL ?? 0));
  const kd = Math.abs(Number(env.SQC_HS_KD ?? 25));
  const sgn = Number(env.SQC_HS_SIGN ?? 1) < 0 ? -1 : 1;

  // ── 力矩分量 ──
  // (a) 膝竖直：**逐侧**（左右独立），由膝额状轴出力，同号
  const tauKneeL = sgn * (kpKneeL * kneeL - kd * rate.kneeL);
  const tauKneeR = sgn * (kpKneeR * kneeR - kd * rate.kneeR);
  // (b) 骨盆侧移：同向
  const tauPelvis = sgn * (kpPelvis * pelvisRes - kd * rate.pelvis);
  // (c) 髋侧倾（roll）：同向
  //     实测 hip_0 同向 → Δroll +7.0；roll 正 = 左髋高 ⇒ 需要把它压平
  const tauRoll = sgn * (kpRoll * roll - kd * rate.roll);

  // ⑤ CoP 侧向预算（论文硬约束）
  const copBuf = new Float64Array(3);
  let copMargin = FOOT_HALF_W;
  for (const sd of ['l', 'r'] as const) {
    const bi = w.body.indexByKey.get(`foot_${sd}`);
    if (bi === undefined) continue;
    const fp = w.body.bodies[bi]!.translation();
    if (w.body.footCoP(sd, w.dt, copBuf)) {
      copMargin = Math.min(copMargin, Math.max(0, FOOT_HALF_W - Math.abs(copBuf[1]! - fp.z)));
      copMargin = Math.min(copMargin, Math.max(0, FOOT_HALF_L - Math.abs(copBuf[0]! - fp.x)));
    }
  }
  // 4cm CoP 偏移 ≈ 10N·m（实测）⇒ 由 CoP 余量反推力矩上限
  const copPerTau = Math.abs(Number(env.SQC_HS_COP_PER_TAU ?? 0.0004));
  const budget = copMargin / Math.max(1e-6, copPerTau);
  const capBase = Math.abs(Number(env.SQC_HS_CAP ?? 20));

  const clampT = (v: number): number => Math.max(-capBase, Math.min(capBase, v));
  // 膝分量单独上限（膝 τmax=450、权限最大 ⇒ 可以比髋给更多力）
  const kneeCap = Math.abs(Number(env.SQC_HS_KNEE_CAP ?? 30));
  const clampK = (v: number): number => Math.max(-kneeCap, Math.min(kneeCap, v));

  // ⑥ 分配（按**物理平面**选轴，不按逻辑轴号）
  //
  //  用户的分工要求（2026-10-28）：
  //    「发力的是膝盖和大腿，小腿支撑就行了」
  //    「膝盖还需要限位别让大腿拧」
  //  ⇒ 主动力矩只给 **髋**（大腿根）与 **膝**（大腿/小腿交界）
  //  ⇒ 小腿（shin）只做被动支撑，不主动出力
  //  ⇒ 另加**膝扭转限位**：大腿绕小腿拧 → 限住
  //
  //  膝的逻辑 0/1 因多环链 preRing 而互换（逻辑 0 实为扭转、逻辑 1 实为额状），
  //  必须用 frontalAxis/torsionAxis 按物理平面取轴。
  const common = clampT((tauPelvis + tauRoll) * 0.5);

  const emit = (dofIndex: number, tau: number, src: string): void => {
    if (dofIndex < 0) return;
    const d = w.body.dofs[dofIndex]!;
    if (d.preRing || d.engineMotor) return;
    if (Math.abs(tau) < 1e-6) return;
    propose({ dof: dofIndex, kind: 'ext', pri: PRI.reflex, tau, src, channel: 'active' });
  };

  for (const sd of ['l', 'r'] as const) {
    // (a) 膝竖直：**该侧的膝额状轴**直接出力（实测 knee 额状轴权限最大：
    //     knee_1 同向 L=−12.97 / R=−5.45 cm per 10N·m）
    //     「小腿支撑就行了」⇒ 膝出力改变的是**大腿相对小腿**的额向关系 = 膝盖摆正
    const kneeFr = frontalAxis(w.body, `knee_${sd}`);
    const tauKnee = sd === 'l' ? tauKneeL : tauKneeR;
    if (kneeFr !== null) emit(w.body.dofByName(`knee_${sd}`, kneeFr), clampK(tauKnee), 'squat.hipStrategy.knee');

    // (b) 髋水平：髋额状轴出力（同向部分）
    const hipFr = frontalAxis(w.body, `hip_${sd}`);
    if (hipFr !== null) emit(w.body.dofByName(`hip_${sd}`, hipFr), common, 'squat.hipStrategy.hip');
  }

  // (c) 膝扭转限位：「膝盖还需要限位别让大腿拧」
  //     大腿绕小腿拧 ⇒ 膝的**扭转轴**偏离 0 ⇒ 单向弹簧拉回
  //     ★ 死区必须够大（默认 12°）：实测 8° 时它会把额状面一起带偏
  //       （max膝 5.82→11.25、maxShift 13.82→21.08）——扭转耦合进额状。
  //       膝的扭转读数本身就在 ±5° 内摆，12° 死区 ⇒ 只在真拧过头时才介入。
  const twistK = Math.abs(Number(env.SQC_HS_TWIST_K ?? 40));
  const twistB = Math.abs(Number(env.SQC_HS_TWIST_B ?? 4));
  const twistCap = Math.abs(Number(env.SQC_HS_TWIST_CAP ?? 15));
  const twistDeg = Math.abs(Number(env.SQC_HS_TWIST_DEG ?? 12)) / 57.3;
  for (const sd of ['l', 'r'] as const) {
    const ax = torsionAxis(w.body, `knee_${sd}`);
    if (ax === null) continue;
    const di = w.body.dofByName(`knee_${sd}`, ax);
    if (di < 0) continue;
    const d = w.body.dofs[di]!;
    if (d.preRing || d.engineMotor) continue;
    // 目标 = 闭链目标角（大腿相对小腿的扭转目标）；超出死区才出力
    const ref = closedChainAngleByName(tgt, `knee_${sd}`, ax);
    const rest = ref ?? 0;
    const dev = rest - d.angle;
    if (Math.abs(dev) < twistDeg) continue;
    const tau = Math.max(-twistCap, Math.min(twistCap, twistK * dev - twistB * d.vel));
    emit(di, tau, 'squat.hipStrategy.twist');
  }
  void ctl;
}
