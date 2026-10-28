/**
 * hipStrategy.ts —— 蹲姿回正力写手（2026-10-28 架构定稿）
 *
 * ════════════════════════════════════════════════════════════════════════
 * 一、职责（唯一）
 * ════════════════════════════════════════════════════════════════════════
 *   本模块是**蹲姿额状面回正力的唯一写手**。它只做三件事：
 *
 *     ① 膝竖直  —— 膝在踝正上方（不内扣不外撇）
 *     ② 髋水平  —— 骨盆不侧移、不侧倾
 *     ③ 膝扭转限位 —— 大腿绕小腿拧过头时拉住（防大腿拧）
 *
 *   不做：矢状面回正（归 pair 肌肉对）、上身回正（归 spinePassive）、
 *        踝策略（归 squatAnkleFeedforward）。
 *
 * ════════════════════════════════════════════════════════════════════════
 * 二、用户的力链分工（2026-10-28 原话）
 * ════════════════════════════════════════════════════════════════════════
 *   「膝盖竖直，髋水平」
 *   「力链畅通，脚发力别动小腿」
 *   「膝关节也要做大腿旋转的限位」
 *
 *   ⇒ 主动力矩只给 **髋**（大腿根）与 **膝**（大腿/小腿交界）
 *   ⇒ **小腿（shin）只被动支撑，不主动出力** —— 力链由髋/膝发起，
 *      经膝传到小腿，再由小腿传到脚，最后由脚的 CoP 传给地面，
 *      地面反力回推骨盆（这正是用户设计的「脚发力传给髋」）。
 *
 * ════════════════════════════════════════════════════════════════════════
 * 三、写手归属（不抢其他写手）
 * ════════════════════════════════════════════════════════════════════════
 *   hip_额状轴   ← 本模块**独占**
 *   knee_额状轴  ← 本模块**独占**
 *   knee_扭转轴  ← 本模块**独占**
 *   hip_扭转轴   ← squatHipSoftLimit（解剖限位），本模块不碰
 *   hip/膝/踝_矢状轴 ← squatPairBase（肌肉对），本模块不碰
 *
 *   通道：ext / 'active'（与 passive 通道分离 ⇒ 弱耦合而非对拉）
 *   优先级：PRI.reflex（60，低于 pair/action 的基础力）
 *
 *   ⚠ 物理平面 ≠ 逻辑轴号：膝的逻辑 0/1 因多环链 preRing 而互换
 *     （见 jointPlane.ts 的实测表）⇒ 一律用 frontalAxis()/torsionAxis() 取轴。
 *
 * ════════════════════════════════════════════════════════════════════════
 * 四、论文依据
 * ════════════════════════════════════════════════════════════════════════
 *   Mirshams Shahshahani & Ashton-Miller 2020, PLoS One 15(11):e0242454：
 *     · 'hip strategy' = 髋在支撑脚上产生剪切力 → 经地面反力影响 COM。
 *     · 'COP 不能移出 BOS' ⇒ 权限由 CoP 侧向余量决定，不是髋的 τmax。
 *     · 静态平衡：COM 的地面投影必须与 COP 重合。
 *   Afschrift et al. 2016, J Neurophysiol：
 *     踝/髋策略是**连续谱**；省力权重↑ → 偏踝策略 ⇒ 本写手必须有死区。
 *
 * ════════════════════════════════════════════════════════════════════════
 * 五、实测标定（tools/_tmp-*.ts，物理级）
 * ════════════════════════════════════════════════════════════════════════
 *   权限（膝额状轴，+10N·m×0.4s，同向）：
 *     左 Δ(膝z−踝z)=+13.6cm、右 +8.8cm ⇒ 权限 1.36 / 0.88 cm/(N·m)
 *   权限（髋额状轴，同向）：
 *     骨盆侧移 Δ=+4.1cm/10N·m ⇒ 0.41 cm/(N·m)
 *     髋侧倾   Δ=+7.0cm/10N·m ⇒ 0.70 cm/(N·m)
 *   闭环扫描最优：kpKnee=150/220、kpPelvis=245、dead=1cm
 *     max膝 5.26→1.99、maxRoll 4.08→0.79、maxShift 6.43→1.39
 *   ★ roll 分量与膝分量打架（同向髋力矩冲掉膝的修正）⇒ roll 默认关
 *
 * ════════════════════════════════════════════════════════════════════════
 * 六、★ 已知局限（诚实记录，见 docs/蹲姿回正力-架构定稿-2026-10-28.md）
 * ════════════════════════════════════════════════════════════════════════
 *   ① 目标角表被 court.ts:705 的 captureAngFrom 全覆盖 ⇒ 轴0 的几何零
 *      （baseTable 的 hip0:0/knee0:0/foot0:0）失效 ⇒ pair/frontalPassive
 *      的回正目标变成「保持现状」。本模块不依赖那张表（用闭链几何目标）。
 *   ② 髋额向漂移的真正来源是**矢状基础力经链几何的耦合**（实测 hip_额状轴
 *      τ 全程 0，髋角却漂 −9°；关驱动后只漂 −1.03°）。
 *      ⇒ 额状回正力只能部分抵消，根因要靠基础力侧修。
 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import { propose, PRI } from '../proposalBus';
import { baseState } from './baseTable';
import {
  captureClosedChainTarget, solveClosedChainAngles, closedChainAngleByName,
  type ClosedChainTarget,
} from './closedChain';
import { frontalAxis, torsionAxis } from './jointPlane';

/** 脚掌几何（court.ts 的支撑区口径）：脚半宽 / 脚半长（m） */
const FOOT_HALF_W = 0.05;
const FOOT_HALF_L = 0.156 * 1.8 / 2;

/** 写手状态（跨帧：渐入渐出 + 残差速率） */
interface HipStrategyState {
  /** 渐入渐出系数 0..1 */
  alpha: number;
  /** 上一帧残差 */
  resPrev: { pelvis: number; roll: number; kneeL: number; kneeR: number };
  /** 上一帧时间 */
  tPrev: number;
}
const _st = new WeakMap<ClosedChainTarget, HipStrategyState>();

/** 闭链目标（捕获一次：脚落点钉死后姿态成形时） */
let _target: ClosedChainTarget | null = null;

/** 供 court.ts 在释放瞬间调用：捕获闭链目标 */
export function captureHipStrategyTarget(w: World): ClosedChainTarget | null {
  _target = captureClosedChainTarget(w.body);
  return _target;
}

/** 供 court.ts / 被动刚度读取当前闭链目标 */
export function hipStrategyTarget(): ClosedChainTarget | null {
  return _target;
}

/** 复位（切状态 / 重置世界） */
export function hipStrategyReset(): void {
  _target = null;
}

/**
 * 蹲姿回正力写手：每帧调用。
 *
 * 流程：
 *   ① 重解闭链目标 → 读四个残差（骨盆侧移 / 髋侧倾 / 膝竖直×2）
 *   ② 死区判定（小偏差不介入 → 交给踝策略 + 被动刚度）
 *   ③ 渐入渐出（避免阶跃）
 *   ④ 残差 → 力矩（含 CoP 预算钳位）
 *   ⑤ 分配到髋额状轴 / 膝额状轴 / 膝扭转轴
 */
export function squatHipStrategy(w: World, ctl: ControlModule): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  if (String(env.SQC_HIP_STRATEGY ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;

  const tgt = _target;
  if (!tgt) return;

  // ① 重解（残差每帧更新 —— 骨盆只被地面反力推动，必须运行时读）
  solveClosedChainAngles(w.body, tgt);

  // ── 读残差 ──
  //  骨盆侧移：目标(双脚中点z) − 骨盆z（正 = 骨盆偏 −z 侧）
  const pelvisRes = tgt.pelvisResidual;
  //  髋侧倾（roll）：髋L.y − 髋R.y（正 = 左髋高）
  const hl = w.body.dofs[w.body.dofByName('hip_l', 2)]!;
  const hr = w.body.dofs[w.body.dofByName('hip_r', 2)]!;
  const roll = hl.anchorWorld[1]! - hr.anchorWorld[1]!;
  //  膝竖直：膝.z − 踝.z（正 = 膝偏 +z = 外撇），目标 0
  const kneeL = tgt.kneeResidualL;
  const kneeR = tgt.kneeResidualR;

  // ② 死区（任一残差超死区才介入）
  //    默认 1cm：实测扫描 —— 1cm 的 maxShift 最小（2.15cm）；3cm ⇒ 膝/roll 失控
  const dead = Math.abs(Number(env.SQC_HS_DEAD ?? 0.01));
  const active = Math.abs(pelvisRes) >= dead
    || Math.abs(roll) >= dead
    || Math.abs(kneeL) >= dead
    || Math.abs(kneeR) >= dead;

  let st = _st.get(tgt);
  if (!st) {
    st = { alpha: 0, resPrev: { pelvis: pelvisRes, roll, kneeL, kneeR }, tPrev: w.clock };
    _st.set(tgt, st);
  }
  if (!active) {
    // 死区内 → 渐出到 0（不突然撤力）
    const ramp = Math.max(1e-3, Number(env.SQC_HS_RAMP ?? 0.2));
    st.alpha = Math.max(0, st.alpha - w.dt / ramp);
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

  // 增益（实测闭环扫描选定）
  const kpKneeL = Math.abs(Number(env.SQC_HS_KP_KNEE_L ?? 150));   // 权限 1.36 cm/(N·m)
  const kpKneeR = Math.abs(Number(env.SQC_HS_KP_KNEE_R ?? 220));   // 权限 0.88 cm/(N·m)
  const kpPelvis = Math.abs(Number(env.SQC_HS_KP_PELVIS ?? 245)); // 权限 0.41 cm/(N·m)
  // ★ roll 分量默认 0：实测与膝分量打架（同向髋力矩冲掉膝的修正）
  const kpRoll = Math.abs(Number(env.SQC_HS_KP_ROLL ?? 0));
  const kd = Math.abs(Number(env.SQC_HS_KD ?? 25));
  const sgn = Number(env.SQC_HS_SIGN ?? 1) < 0 ? -1 : 1;

  const tauKneeL = sgn * (kpKneeL * kneeL - kd * rate.kneeL);
  const tauKneeR = sgn * (kpKneeR * kneeR - kd * rate.kneeR);
  const tauPelvis = sgn * (kpPelvis * pelvisRes - kd * rate.pelvis);
  const tauRoll = sgn * (kpRoll * roll - kd * rate.roll);

  // ⑤ CoP 侧向预算（论文硬约束：COP 不能移出 BOS）
  //    实测：髋额状轴 10N·m ⇒ CoP 移 4.1cm ⇒ 0.0004 m/(N·m)
  const copBuf = new Float64Array(3);
  let copMargin = FOOT_HALF_W;
  for (const sd of ['l', 'r'] as const) {
    const bi = w.body.indexByKey.get(`foot_${sd}`);
    if (bi === undefined) continue;
    const fp = w.body.bodies[bi]!.translation();
    if (!w.body.footCoP(sd, w.dt, copBuf)) continue;
    copMargin = Math.min(copMargin, Math.max(0, FOOT_HALF_W - Math.abs(copBuf[1]! - fp.z)));
    copMargin = Math.min(copMargin, Math.max(0, FOOT_HALF_L - Math.abs(copBuf[0]! - fp.x)));
  }
  const copPerTau = Math.abs(Number(env.SQC_HS_COP_PER_TAU ?? 0.0004));
  // 余量 0 ⇒ 预算 0（CoP 已贴边，不能再推）
  const budget = copMargin / Math.max(1e-6, copPerTau);

  const capBase = Math.abs(Number(env.SQC_HS_CAP ?? 20));
  const kneeCap = Math.abs(Number(env.SQC_HS_KNEE_CAP ?? 30));
  // ★ 髋力矩受 CoP 预算钳位（论文约束真正生效的地方）
  const hipCap = Math.min(capBase, budget);
  const clampHip = (v: number): number => Math.max(-hipCap, Math.min(hipCap, v));
  const clampKnee = (v: number): number => Math.max(-kneeCap, Math.min(kneeCap, v));

  // ⑥ 分配
  const emit = (dofIndex: number, tau: number, src: string): void => {
    if (dofIndex < 0) return;
    const d = w.body.dofs[dofIndex]!;
    if (d.preRing || d.engineMotor) return;
    if (Math.abs(tau) < 1e-6) return;
    propose({ dof: dofIndex, kind: 'ext', pri: PRI.reflex, tau, src, channel: 'active' });
  };

  // 髋水平：同向（两髋各拿一半）—— 骨盆侧移 + 髋侧倾
  const hipCommon = clampHip((tauPelvis + tauRoll) * 0.5);
  // 膝竖直：逐侧（左右独立），由膝额状轴出力
  const kneeTauL = clampKnee(tauKneeL);
  const kneeTauR = clampKnee(tauKneeR);

  for (const sd of ['l', 'r'] as const) {
    // (a) 膝竖直 → 膝额状轴
    const kneeFr = frontalAxis(w.body, `knee_${sd}`);
    if (kneeFr !== null) {
      emit(w.body.dofByName(`knee_${sd}`, kneeFr), sd === 'l' ? kneeTauL : kneeTauR, 'squat.hipStrategy.knee');
    }
    // (b) 髋水平 → 髋额状轴（同向）
    const hipFr = frontalAxis(w.body, `hip_${sd}`);
    if (hipFr !== null) {
      emit(w.body.dofByName(`hip_${sd}`, hipFr), hipCommon, 'squat.hipStrategy.hip');
    }
  }

  // (c) 膝扭转限位：「膝关节也要做大腿旋转的限位」
  //     大腿绕小腿拧 ⇒ 膝**扭转轴**偏离目标 ⇒ 单向弹簧拉回。
  //     ★ 死区 12°：8° 时它把额状面一起带偏（max膝 5.82→11.25）——扭转耦合进额状。
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
    // 目标 = 闭链目标角（大腿相对小腿的扭转目标）
    const ref = closedChainAngleByName(tgt, `knee_${sd}`, ax) ?? 0;
    const dev = ref - d.angle;
    if (Math.abs(dev) < twistDeg) continue;
    const tau = Math.max(-twistCap, Math.min(twistCap, twistK * dev - twistB * d.vel));
    emit(di, tau, 'squat.hipStrategy.twist');
  }
  void ctl;
}
