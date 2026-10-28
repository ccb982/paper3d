/** squat.ts — 新支撑/回正架构（2026-10-27 清理版）
 *
 * 只保留：
 *   - 矢状 pair/base 支撑
 *   - 踝矢状前馈
 *   - 下盘倒向侧 hip/2、knee/2、foot/0 支撑
 *   - 上盘 HAT 回正（默认关）
 *   - 正面/脊柱被动刚度、髋软限位
 *
 * 旧 ankleVector / backSpine / rc2 / passiveLock / hipStrut 等回正写手已删除。
 */
import { baseState, baseParams, baseAng } from './baseTable';
import { propose, PRI } from '../proposalBus';
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep } from '../court';
import { squatHipStrategy } from './hipStrategy';
import { squatStandardAngle } from './squatPose';

export { squatCourtSetup, courtStep, type CourtState } from '../court';

const _dofLimitsOrig = new Map<number, { min: number; max: number }>();

export function squatPairBase(w: World, ctl: ControlModule): void {
  if (baseState() !== 'squat') return;
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!baseBuf) return;   // 未捕获 → 蹲姿不写 pair
  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PAIR_OFF ?? '0') === '1') return;
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const bp = baseParams() as unknown as { pairC?: number };
  const cPair = Number(env.SQC_PAIR_C ?? bp.pairC ?? 0.7);
  const vecMode = String(env.SQC_ANKLE_VEC ?? '1') !== '0';   // 3D 矢量转接口模式
  const pairLatOn = String(env.SQC_PAIR_LAT ?? '0') === '1';
  const coOn = String(env.SQC_COACT ?? '1') === '1';
  const coK = Number(env.SQC_COACT_K ?? 200);
  const coB = Number(env.SQC_COACT_B ?? 20);
  const coCap = Math.abs(Number(env.SQC_COACT_CAP ?? 30));
  const coHipK = Number(env.SQC_COACT_HIP_K ?? 0);
  const coHipB = Number(env.SQC_COACT_HIP_B ?? 0);
  const coHipCap = Math.abs(Number(env.SQC_COACT_HIP_CAP ?? 30));
  const pairScale = Math.abs(Number(env.SQC_PAIR_SCALE ?? 1));
  for (const d of body.dofs) {
    if (d.engineMotor) continue;
    // ★ 预环（ring0）已被物理锁死 [rest,rest]，写手 skip（防脏账/浪费算力）
    if (d.preRing) continue;
    // ★ 基础力全走矢状面：foot/ankle 只放行 pitch（轴 2）；侧向/扭转（0/1）不给权限
    //   vecMode：foot/ankle 全部交给 ankleVec 的 3D 分配器，pair 不再写脚踝
    // ★ vec 模式：基础力只允许矢状轴 2；hip/knee/spine/neck 的轴 0 也排除
    const lateralPair = pairLatOn && d.axis === 0 && /^(hip|knee|spine|neck)/.test(d.name);
    if (vecMode && d.axis !== 2 && !lateralPair) continue;
    const isTrunkLeg = /^(hip|knee|spine|neck)/.test(d.name) && (d.axis === 0 || d.axis === 2);
    // v3：矢状 pair 只写 axis 2；横向交给被动刚度/软限位，不混入 pair
    if (String(env.SQC_PAIR_SAGITTAL_ONLY ?? '1') === '1' && d.axis !== 2) continue;
    const isFootPitch = !vecMode && /^(foot|ankle)/.test(d.name) && d.axis === 2;
    if (!(isTrunkLeg || isFootPitch || lateralPair)) continue;
    let base = lateralPair ? 0 : (baseBuf[d.dofIndex] ?? 0);
    let ref = baseAng(d.name, d.axis) ?? d.angle;
    let c = lateralPair ? Number(env.SQC_PAIR_C_LAT ?? 0.25) : cPair;
    if (String(env.SQC_PASSIVE_MODE ?? '0') === '1' && !lateralPair) {
      const side = d.name.endsWith('_l') ? 'l' : d.name.endsWith('_r') ? 'r' : null;
      const fz = side ? body.footNormalForce(side, w.dt) : (body.footNormalForce('l', w.dt) + body.footNormalForce('r', w.dt)) / 2;
      const loadK = Math.max(0, Number(env.SQC_PB_C_LOAD ?? 0.5));
      c = Math.min(0.9, c * (1 + loadK * (fz / Math.max(1, w.sk.massTotal * 9.81))));
    }
    if (coOn && /^knee_/.test(d.name) && d.axis === 2) {
      const e = ref - d.angle;
      const tco = Math.max(-coCap, Math.min(coCap, coK * e - coB * d.vel));
      base += tco;
    }
    if (coOn && /^hip_/.test(d.name) && d.axis === 2) {
      const e = ref - d.angle;
      const tco = Math.max(-coHipCap, Math.min(coHipCap, coHipK * e - coHipB * d.vel));
      base += tco;
    }
    let refEff = ref;
    if (String(env.SQC_PASSIVE_MODE ?? '0') === '1' && !lateralPair) {
      // 短程刚度：K/C 不变，只让目标误差饱和 → 力饱和，不软化弹簧。
      const sat = Math.abs(Number(env.SQC_PB_SAT_DEG ?? 10.0)) / 57.3;
      const e = ref - d.angle;
      refEff = d.angle + Math.max(-sat, Math.min(sat, e));
    }
    propose({ dof: d.dofIndex, kind: 'pair', pri: PRI.action, c, rad: refEff, tau: base * pairScale, src: lateralPair ? 'squat.pairBase.lat' : 'squat.pairBase' });
  }
}

/** 脊柱被动刚度：只写 spine1-3 的侧向/扭转（轴 0/1）。
 *  中性角=0，不读 CoM；超死区才出力，纯弹簧+阻尼。 */
function squatSpinePassive(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_SPINE_PASSIVE ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const K = Math.abs(Number(env.SQC_SP_K ?? 80));
  const B = Math.abs(Number(env.SQC_SP_B ?? 4));
  const cap = Math.abs(Number(env.SQC_SP_CAP ?? 30));
  const dead = Math.abs(Number(env.SQC_SP_DEAD_DEG ?? 0.5)) / 57.3;
  for (const nm of ['spine1', 'spine2', 'spine3'] as const) {
    for (const ax of [0, 1] as const) {
      const di = w.body.dofByName(nm, ax);
      if (di < 0) continue;
      const d = w.body.dofs[di]!;
      if (Math.abs(d.angle) < dead && Math.abs(d.vel) < 0.01) continue;
      const oneWay = String(env.SQC_SP_ONE_WAY ?? '0') !== '0';
      let tau: number;
      if (oneWay) {
        // 单向被动：只在被继续拉离中性时产生弹簧；回程不再“拉回目标”
        const away = d.angle * d.vel > 0;
        const sgn = d.angle >= 0 ? 1 : -1;
        const oSign = Number(env.SQC_SP_ONE_WAY_SIGN ?? 1) < 0 ? -1 : 1;
        const spring = away && Math.abs(d.angle) > dead ? oSign * -K * (d.angle - sgn * dead) : 0;
        tau = spring - B * d.vel;
      } else {
        tau = -K * d.angle - B * d.vel;
      }
      tau = Math.max(-cap, Math.min(cap, tau));
      if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.spinePassive', channel: 'passive' });
    }
  }
}

/** 下盘倒向侧支撑偏置：侧倒那一条腿的髋/膝在矢状面多撑；
 *  只是支撑增益，不做上身回正，不读目标角。 */
function squatFallSideSupport(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const k = Math.abs(Number(env.SQC_FALL_SUPPORT ?? 0));
  if (k <= 0 || baseState() !== 'squat' || !st.released) return;
  const tr = ctl.lateral.parts['trunk'];
  const eUpper = (tr?.roll ?? 0) - (st.trunkRoll0 ?? 0);
  const eK = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FALL_TRUNK_K ?? 0);
  const e = (ctl.sensors.com[2]! - st.c0.z) + ctl.sensors.comVel[2]! / Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!)) + eK * eUpper;
  const side = e < 0 ? 'r' : 'l';
  const s = Math.max(0, Math.min(1, Math.abs(e) / 0.05));
  const buf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  const cap = Math.abs(Number(env.SQC_FALL_CAP ?? 40));
  for (const [part, ax, gain] of [
    ['hip', 2, k],
    ['knee', 2, k],
    ['foot', 2, Math.abs(Number(env.SQC_FALL_FOOT ?? 0))],
  ] as const) {
    if (gain <= 0) continue;
    const di = w.body.dofByName(`${part}_${side}`, ax);
    if (di < 0) continue;
    const base = buf ? buf[di] ?? 0 : 0;
    const tau = Math.max(-cap, Math.min(cap, base * gain * s));
    if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.fallSupport', channel: 'support' });
  }
  const ankleK = Math.abs(Number(env.SQC_FALL_ANKLE ?? 0));
  if (ankleK > 0) {
    const aSign = Number(env.SQC_FALL_ANKLE_SIGN ?? 1) < 0 ? -1 : 1;
    const fi = w.body.dofByName(`foot_${side}`, 0);
    if (fi >= 0) {
      const aCap = Math.abs(Number(env.SQC_FALL_ANKLE_CAP ?? 12));
      const tau = Math.max(-aCap, Math.min(aCap, aSign * ankleK * s));
      if (Math.abs(tau) > 1e-6) propose({ dof: fi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.fallSupport.ankle', channel: 'support' });
    }
  }
}

interface UpperRightState { alpha: number; armed: boolean; }
const _upperRight = new WeakMap<CS, UpperRightState>();

/** 上身回正：预测 HAT roll，安全区内小力矩、区外大力矩，带滞回和渐入渐出。
 *  只写 spine1-3 轴0；预算受双脚 fz/CoP 余量限制，脚没余量就不发。 */
function squatUpperRighting(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_UPPER_RIGHTING ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  let u = _upperRight.get(st);
  if (!u) { u = { alpha: 0, armed: false }; _upperRight.set(st, u); }
  const tr = ctl.lateral.parts['trunk'];
  const e = (tr?.roll ?? 0) - (st.trunkRoll0 ?? 0);
  const rate = ctl.sensors.torsoAngVel[0]!;
  const lead = Math.abs(Number(env.SQC_UR_LEAD ?? 0.12));
  const pred = e + lead * rate;
  const inner = Math.abs(Number(env.SQC_UR_INNER_DEG ?? 1.2)) / 57.3;
  const outer = Math.abs(Number(env.SQC_UR_OUTER_DEG ?? 3.5)) / 57.3;
  const mag = Math.abs(pred);
  if (!u.armed && mag >= outer) u.armed = true;
  else if (u.armed && mag <= inner * 0.7) u.armed = false;
  const target = u.armed ? 1 : 0;
  const tIn = Math.max(1e-3, Number(env.SQC_UR_IN_T ?? 0.2));
  const tOut = Math.max(1e-3, Number(env.SQC_UR_OUT_T ?? 0.35));
  const a = 1 - Math.exp(-w.dt / (target > u.alpha ? tIn : tOut));
  u.alpha += (target - u.alpha) * a;
  if (u.alpha < 1e-4) return;
  const fzL = w.body.footNormalForce('l', w.dt);
  const fzR = w.body.footNormalForce('r', w.dt);
  const W = w.sk.massTotal * 9.81;
  const footMargin = Math.max(0, Math.min(fzL, fzR) - 0.1 * W);
  const budget = Math.min(Math.abs(Number(env.SQC_UR_CAP ?? 18)), footMargin * Math.abs(Number(env.SQC_UR_FOOT_K ?? 0.04)));
  if (budget <= 1e-6) return;
  const K = Math.abs(Number(env.SQC_UR_K ?? 180));
  const D = Math.abs(Number(env.SQC_UR_D ?? 8));
  const urSign = Number(env.SQC_UR_SIGN ?? 1) < 0 ? -1 : 1;
  let tau = urSign * (K * pred + D * rate);
  tau = Math.max(-budget, Math.min(budget, tau));
  tau *= u.alpha;
  (globalThis as { __URDBG?: unknown }).__URDBG = { t: st.t, e, rate, pred, alpha: u.alpha, budget, tau };
  const wts = [0.25, 0.35, 0.40] as const;
  for (let k = 0; k < 3; k++) {
    const di = w.body.dofByName((['spine1','spine2','spine3'] as const)[k]!, 0);
    if (di < 0) continue;
    propose({ dof: di, kind: 'ext', pri: PRI.direct, tau: tau * wts[k]!, src: 'squat.upperRighting', channel: 'active' });
  }
}

/** 额状面被动刚度（踝 roll）—— **已并入 squatLegPassiveTension**（2026-10-28）
 *
 *  合并原因：① 踝额状轴与髋/膝的额状+扭转轴是同一类「被动刚力」，
 *  同一 passive 通道每轴只能有一个写手（提案总线按 dof|kind|channel 仲裁）。
 *  ② 踝必须与髋/膝用**同一套左右镜像归一**（实测 _tmp-signcal2.ts：
 *  反号 τ = 同向效果 ⇒ 破对称；同号 τ = 镜像效果）。
 */

/**
 * ★★ 蹲姿腿部被动张力（2026-10-28）—— 髋/膝/踝 的**额状面 + 纵向扭转**下限刚度。
 *
 * ═══ 用户定调（2026-10-28）══════════════════════════════════════════════
 *   「踝的被动刚力和回正力属于两种东西」
 *   「但是小腿腿偏了都要发力」
 *
 *   ⇒ **两种东西，两个写手，两个通道，但都作用在偏了的小腿上**：
 *     · 本写手 = **被动刚力**（解剖被动组织：韧带/肌腱/结缔组织的弹性力）
 *       通道 = passive，目标 = **解剖中立位**
 *       管的轴 = **扭转轴**（外八）+ **踝的额状轴**（内翻/外翻）
 *     · squatHipStrategy = **回正力**（主动策略，位置空间）
 *       通道 = active，目标 = **闭链位置基准**（脚落点推出来的膝/髋位置）
 *       管的轴 = 膝/髋的**额状轴**（膝竖直、髋水平）
 *     两条通道在 executor 里**分开记账、最后相加**（`executor.ts:204,236`）
 *     ⇒ 物理上就是论文里的「主动肌肉 + 被动组织」并联承载，不是二选一、不是对拉。
 *
 *   ★★ 当前范围 = **只有踝**（额状轴 + 扭转轴）。实测（tools/_tmp-sag.ts）：
 *     写髋扭转轴 → Δ大腿yaw 40.9°（自己就是扭转源；世界轴偏竖直 27.6°）
 *     写膝扭转轴 → Δ大腿yaw 32.5°（世界轴偏竖直 15.3°，且 rest=8° 已被外八占用）
 *     写踝两轴   → Δ大腿yaw 35.3°（踝额状轴世界轴 [0.873,−0.488,0] 偏水平 29°）
 *     全部关掉   → Δ大腿yaw  0.8° ✔
 *     ⇒ **多环链上的「角度弹簧」会泄漏**：关节轴不纯（偏水平/竖直十几到三十度），
 *       额状力矩 ⇒ 泄漏成矢状力矩 ⇒ 拧大腿。
 *     ⇒ 正确的「别乱动」形态是**位置/几何弹簧**（踝面朝向、膝在踝正上方），
 *       而那正是主动回正（闭链）做的事。
 *     ⇒ 保留本写手只写踝（等踝轴的泄漏被显式建模后自然生效），其余轴：
 *       · 额状竖直 → 主动回正（闭链位置）
 *       · 别拧过头 → 解剖限位（限位通道，不泄漏）
 *
 *   ★★ 为什么膝/髋的**额状轴**不归被动刚力（实测 _tmp-freeze-pose2.ts）：
 *     「腿竖直」是**位置**问题（膝在踝正上方），不是角度问题。
 *     实测把膝额状从 14.5° 收到 0°：膝踝间距只有 32.6cm，收 14.5° 必然把膝往中线挤
 *     ⇒ 膝被推离踝 8.8cm ⇒ 大腿倾 37.9° ⇒ 拧转反而更大
 *     （冻结期 Δ大腿yaw 4.3° → 26.5°）。
 *     ⇒ 额状竖直必须走**闭链位置目标**（主动回正），不能走角度弹簧。
 *
 * ── 为什么需要（实测 tools/_tmp-freeze-left.ts / _tmp-web-check.ts）───────
 *   ① 冻结期大腿相对躯干拧了 47.6°（左腿在 +Z 侧 ⇒ 大腿正面转向中线
 *      ⇒ 视觉上就是「膝盖朝内/内收」）；而这几个轴施加力矩**全程 0 N·m** ⇒ 纯自由漂移。
 *   ② 网页实测（放开 t=2.07s）：`knee_l/1 = 13.25°`（膝额状张开 13°⇒内收）
 *      `foot_l/0 = 14.73°`（踝额状 14.7°，**限位只有 ±14° ⇒ 连踝都超限**）
 *      ⇒ 「踝随便偏移」「膝盖和踝不严格竖直」。
 *   ③ 根因：被动刚度的 ref 取自 `baseAng`，而 `captureAngFrom` 原来写的是
 *      **带侧别的全名键**（`foot_l0`/`knee_l1`），而 BASE_TABLE 里写死的是
 *      **不带侧别的基名键**（`foot0:0`/`knee1:0`=几何零）；
 *      `baseAng` 查表全名键优先 ⇒ **几何零从来没生效过**，
 *      被动刚度一直在拉那个歪的实测值（踝 12.09°、膝 14.50°）。
 *      ⇒ 已修：captureAngFrom 改写基名键 + baseAng 基名键优先 + 表里几何零改正。
 *
 * ── 物理平面 ≠ 逻辑轴号（见 jointPlane.ts 实测表）────────────────────────
 *   膝 逻辑0=扭转(Y) 逻辑1=额状(X) 逻辑2=矢状(Z)
 *   髋 逻辑0=额状(X) 逻辑1=扭转(Y) 逻辑2=矢状(Z)
 *   踝 逻辑0=额状(X) 逻辑1=扭转(Y) 逻辑2=矢状(Z)
 *
 * ── ★★★ 左右力矩符号（实测标定 tools/_tmp-signcal2.ts）──────────────────
 *   膝额状轴的世界轴左右**不是简单镜像**：
 *     knee_l/1 = [−0.955, 0.261, −0.140]   knee_r/1 = [−0.955, 0.261, +0.141]
 *   （x 分量同号、只有 z 分量反号）⇒
 *     · **同号 τ** ⇒ 两膝 z **同向**移动（实测 Δ膝z L=−8.61 / R=−9.28cm）= 破对称 ✘
 *     · **反号 τ** ⇒ 两膝 z **反向**移动（实测 Δ膝z L=−2.81 / R=+3.91cm）= 对称 ✔
 *   而读数被 `mirrorSymmetric` 强制成镜像（左 = −右）⇒ `ref − d.angle` 左右天然反号
 *   ⇒ **左右各自算 dev、发反号 τ ⇒ 物理效果对称**（这是本写手一直用的写法，正确）。
 *
 * ── 论文依据 ────────────────────────────────────────────────────────────
 *   ① 被动张力是真实存在的力源：非收缩成分（titin/结缔组织）的弹性力随肌肉
 *      拉长单调增长，是姿势稳定的**下限刚度**（Privett et al. 2024 实测被动模量；
 *      疲劳会降低它 ⇒ 是持续的、不可忽略的项）。
 *   ② 被动不足（passive insufficiency）：跨双关节肌被两端同时拉长到极限时
 *      被动张力飙升 ⇒ 天然限制 ROM ⇒ 「别让大腿拧过头」的物理依据。
 *   ③ 动态膝外翻（dynamic knee valgus）= 股骨内旋+髋内收+胫骨外展+踝外翻
 *      （Joseph 2008；Claiborne 2006）——纠正它靠**主动**控制；
 *      被动组织只提供下限刚度。
 */
function squatLegPassiveTension(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LEG_TENSION ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const target = String(env.SQC_LT_TARGET ?? 'zero');
  // 超解剖范围 ⇒ 刚度加大（原 squatHipSoftLimit 的职责）
  const kOut = Math.abs(Number(env.SQC_LT_K_OUT ?? 120));
  const capOut = Math.abs(Number(env.SQC_LT_CAP_OUT ?? 120));
  // ★ KA 实测扫描（tools/_tmp-ka2.ts）：30→60 让踝额状 9.4°→5.1°、扭转 −5.4°→−11.2°、
  //   左右不对称 0.13→0.02cm；再往上（120）踝更好但膝额状升到 16°（偏差转移到膝）⇒ 60 是拐点。
  const KA = Math.abs(Number(env.SQC_LT_K_ANKLE ?? 60));
  const BA = Math.abs(Number(env.SQC_LT_B_ANKLE ?? 2));
  const capA = Math.abs(Number(env.SQC_LT_CAP_ANKLE ?? 40));
  const deadA = Math.abs(Number(env.SQC_LT_DEAD_ANKLE_DEG ?? 0.5)) / 57.3;

  // ★★★ 膝的扭转轴（小腿相对大腿的拧转）——用户要的「小腿腿偏了都要发力」
  //   单独增益：它是**下限刚度**，不是回正力 ⇒ 增益要软、死区要大（别跟主动力对拉）。
  const KK = Math.abs(Number(env.SQC_LT_K_KNEE ?? 25));
  const BK = Math.abs(Number(env.SQC_LT_B_KNEE ?? 1.5));
  const capK = Math.abs(Number(env.SQC_LT_CAP_KNEE ?? 12));
  const deadK = Math.abs(Number(env.SQC_LT_DEAD_KNEE_DEG ?? 1.5)) / 57.3;

  // ★★★ 分工（用户 2026-10-28：「踝的被动刚力和回正力属于两种东西」）：
  //   被动刚力 = **解剖被动组织** ⇒ 目标是「解剖中立位」，只管**扭转**（外八）。
  //   主动回正 = **位置空间**（闭链：膝在踝正上方 / 髋水平）⇒ 由 squatHipStrategy 管。
  //
  // ★★★ 2026-10-28 修正（实测 tools/_tmp-base.ts）：
  //   本写手原来写 **foot/0（踝额状轴）**，K=60。实测：
  //     · 它确实压住了歪踝（踝额状 11.02° → 2.73°）——**额状那半是真有效**；
  //     · 但 foot/0 的世界轴 = [0.898,−0.409,0.161] ⇒ **41% 泄漏成扭转**
  //       ⇒ 大腿vs小腿 yaw 24.2° → 44.9°（凭空多拧 20°），
  //         且泄漏进矢状 ⇒ 踝矢状 25.7° → −23° ⇒ **判死提前 0.6s**（3.17→2.53）。
  //   ⇒ 踝的**额状轴不归被动刚力**：它是 CoP 执行器，归「踝侧向回正」（位置空间）。
  //   ⇒ 被动刚力只管**扭转**：knee/0（小腿相对大腿）+ foot/1（踝相对小腿）。
  //     —— 这正是用户说的「小腿腿偏了都要发力」：踝三轴对膝/髋位置权限 = 0
  //        （closedChain 标定），踝的被动刚力**管不住小腿偏**，只有膝的扭转轴能管。
  const plan: Array<{ joint: 'knee' | 'foot'; ax: number; k: number; b: number; cap: number; dead: number }> = [
    { joint: 'knee', ax: 0, k: KK, b: BK, cap: capK, dead: deadK },
    { joint: 'foot', ax: 1, k: KA, b: BA, cap: capA, dead: deadA },
  ];
  for (const p of plan) {
    for (const side of ['l', 'r'] as const) {
      const di = w.body.dofByName(`${p.joint}_${side}`, p.ax);
      if (di < 0) continue;
      const d = w.body.dofs[di]!;
      if (d.preRing || d.engineMotor) continue;
      // 目标：zero = 解剖中立位（读数 0，rest 已含外八静偏）；pose = 摆姿快照
      const ref = target === 'pose' ? squatStandardAngle(`${p.joint}_${side}`, p.ax) : 0;
      if (ref === undefined) continue;                      // 没捕获标准姿势 → 不出力
      const dev = ref - d.angle;
      if (Math.abs(dev) < p.dead) continue;
      // 解剖软边界 = 当前关节限位（蹲姿已放宽）
      const soft = Math.max(Math.abs(d.min), Math.abs(d.max));
      const over = Math.abs(dev) - soft;
      const kk = over > 0 ? kOut : p.k;
      const cc = over > 0 ? capOut : p.cap;
      let tau = kk * dev - p.b * d.vel;
      tau = Math.max(-cc, Math.min(cc, tau));
      if (Math.abs(tau) < 1e-6) continue;
      propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.legTension', channel: 'passive' });
    }
  }
}

/** 踝矢状前馈：按 GRF 把 CoP 从踝下推到 CoM 下。
 *  τ_ff = −Fz·(clamp(comX, footSupport) − ankleX)
 *  这是静态重力矩的前馈，不是 (com−cop) 反馈，避免正负高频翻。 */
function squatAnkleFeedforward(w: World, ctl: ControlModule): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_ANKLE_FF ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const gain = Number(env.SQC_ANKLE_FF_GAIN ?? 1);
  const cap = Math.abs(Number(env.SQC_ANKLE_FF_CAP ?? 80));
  const stick = Math.abs(Number(env.SQC_ANKLE_FF_STICK ?? 0.10));
  const comX = ctl.sensors.com[0]!;
  for (const sd of ['l', 'r'] as const) {
    const i = w.body.dofByName(`foot_${sd}`, 2);
    if (i < 0) continue;
    const d = w.body.dofs[i]!;
    const fz = w.body.footNormalForce(sd, w.dt);
    if (fz <= 1) continue;
    const ax = d.anchorWorld[0]!;
    const targetCopX = Math.max(ax - stick, Math.min(ax + stick, comX));
    const tau = Math.max(-cap, Math.min(cap, -gain * fz * (targetCopX - ax)));
    if (Math.abs(tau) > 1e-6) propose({ dof: i, kind: 'ext', pri: PRI.action, tau, src: 'squat.ankleFF', channel: 'support' });
  }
}

/** 恢复 lateralLock 改过的关节限位；World.reset 不做这件事。 */
export function squatResetLimits(w: World): void {
  for (const [di, o] of _dofLimitsOrig) {
    const d = w.body.dofs[di];
    if (!d) continue;
    d.min = o.min;
    d.max = o.max;
    if (d.engineLimited && d.engineJoint) d.engineJoint.setLimits(d.rest + o.min, d.rest + o.max);
  }
  // ★ 2026-10-26 诊断钩子（用户："回正力需要脚多发力申请；不发力的话，踝就直接偏了"）：
  //   实测蹲姿里 `foot_*/0`（踝 roll）静止就被推到 **11.2°**，而限位是 ±14°
  //   ⇒ 只剩 2.8° 行程；同时力矩只用了预算的 7~40% —— **卡的是行程，不是力矩**。
  //   这个 env 只用于确认"行程是不是瓶颈"，默认 0 = 不改任何东西。
  const rollLim = Number(
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FOOT_ROLL_LIM ?? 0,
  );
  if (rollLim > 0) {
    for (const n of ['foot_l', 'foot_r']) {
      const i = w.body.dofByName(n, 0);
      if (i < 0) continue;
      const d = w.body.dofs[i]!;
      const r = rollLim / 57.3;
      d.min = -r; d.max = r;
      if (d.engineLimited && d.engineJoint) d.engineJoint.setLimits(d.rest - r, d.rest + r);
    }
  }
}




export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  squatPairBase(w, ctl);
  squatSpinePassive(w);
  squatLegPassiveTension(w);
  squatAnkleFeedforward(w, ctl);
  squatUpperRighting(w, ctl, st);
  squatFallSideSupport(w, ctl, st);
  // ★ 2026-10-28 额状面髋策略（骨盆位置 → 髋力矩 → 脚 CoP → 地面反力抵消）
  squatHipStrategy(w, ctl);
}
