/** supportClean.ts —— 支撑柱骨架重构版（2026-10-15 用户："架构重置"）
 *
 *  第一性公式（无闸门 / 无锁 / 无模式 / 无捕获事件）：
 *      支撑腿每轴：τ = B0_j（真·常值力矩通道） + kP·(θ_ref − θ) + 单向阻尼
 *      单向阻尼（用户："只有往外偏是阻尼"）：dev·θ̇ > 0（往外）才 τ_damp=−kD·θ̇；回程零写入
 *      θ_ref：首帧捕获（=抬腿结束那刻），此后恒定
 *
 *  · B0 标定目标 = 初态静态载荷（对账工具直接量）——纯基础力维持初态的"由构造保证"
 *  · 全部走提案总线（PRI.action）；不写 pair（不走 λ 弹簧通道）
 *  · 摆动腿：同一公式（B0 小档=持位力矩）
 */
import { propose, PRI } from '../proposalBus';
import { isLiftDone } from './supportReg';   // 抬腿段增益降档用
import type { ServoRefs } from './supportReg';
import { rescueOffsets } from './rescue';
import { trunkClean } from './trunkClean';
import { updateDirState, dirState, comDemand } from './dirState';   // ★ 全局方向态（全链同套参数）+ CoM 需求（链式分配）   // ★ 全新躯干链写手（一通道一写手）   // ★ 修复：rescueOffsets 的唯一调用者(旧supportColumn体)被删→standardPose 永不捕获→upperBase 全死；在 clean 里恢复调用

const envOf = (): Record<string, string> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});

const _ref = new Map<string, number>();
const _devLp = new Map<string, number>();   // 方向选择用低通 dev（防瞬时横跳）
let _tref: [number, number] | null = null;   // 世界倾角初始参考 [pitch, roll]
export function supportCleanReset(): void {
  _ref.clear();
  _devLp.clear();
  _tref = null;
}

const AXES: Array<[string, number]> = [
  ['hip', 0], ['hip', 1], ['hip', 2],
  ['knee', 0], ['knee', 1], ['knee', 2],
  ['foot', 0], ['foot', 1], ['foot', 2],
];

export function supportClean(ctx: ServoRefs, side: 'l' | 'r'): void {
  if (String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).SC_SIDE ?? '0') === '1') ctx.bal.drive.legReflex.side = side;   // ★ side 赋值联动旧模块一堆行为（回归源）——默认关；SC_SIDE=1 对照
  rescueOffsets(ctx, 1 / 240);           // ★ 修复：恢复被删链（standardPose 捕获 + 救援偏移更新）
  updateDirState(ctx, side, 1 / 240);    // ★ 方向态更新（侧向/矢状各一稳定信号）
  if (side === 'r' && String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).TR_ON ?? '1') === '1') trunkClean(ctx, side, 1 / 240);   // ★ 躯干链（TR_ON=0 对照）
  const e = envOf();
  // 支撑侧默认（=现名册）；摆动侧默认（=今日实测定档 髋2:+80 / 膝2:−55）
  const sup = side === 'r';
  const B0: Record<string, number> = sup
    ? { hip0: Number(e.SC_HIP0 ?? 150), hip1: 0, hip2: Number(e.SC_HIP2 ?? 40),   // ★ 严格尺重扫：136→150（SEED3 严格 6.97→7.06）
        knee0: Number(e.SC_KNEE0 ?? 30), knee1: 0, knee2: Number(e.SC_KNEE2 ?? 0),
        foot0: Number(e.SC_FOOT0 ?? 0), foot1: 0, foot2: Number(e.SC_FOOT2 ?? 0) }
    : { hip0: Number(e.SW_HIP0 ?? 0), hip1: 0, hip2: Number(e.SW_HIP2 ?? 80),
        knee0: Number(e.SW_KNEE0 ?? 0), knee1: 0, knee2: Number(e.SW_KNEE2 ?? -55),
        foot0: Number(e.SW_FOOT0 ?? 0), foot1: 0, foot2: Number(e.SW_FOOT2 ?? 0) };
  const kP = sup ? Number(e.SC_KP ?? 120) : Number(e.SW_KP ?? 120);   // ★ 用户："摆动腿可以单独一套"
  const kD = sup ? Number(e.SC_KD ?? 16) : Number(e.SW_KD ?? 12);   // ★ 稳定性首选：KD=16 让动作流三种子 2.82/2.90/2.92（最窄带宽）；KD20=设计姿态峰8.26但动作流散
  // ★ 2026-10-15 用户："种子暴露了某某方向的回正力的问题"——分方向增益（ax0=侧向 / ax2=矢状 / ax1=扭转）
  // ★ 2026-10-15 用户："重心不稳，四个方向的系数都要独立"——左/右/前/后 四套（dev<0=N 侧，≥0=P 侧）
  const kPLN = Number(e.SC_KP_LAT_N ?? 500);   // ★ 严格判据重扫：350→500（SEED3 严格 3.34→6.97；宽松时代定 350）
  const kPLP = Number(e.SC_KP_LAT_P ?? e.SC_KP_LAT ?? kP);
  const kPSN = Number(e.SC_KP_SAG_N ?? e.SC_KP_SAG ?? 400), kPSP = Number(e.SC_KP_SAG_P ?? e.SC_KP_SAG ?? kP);   // ★ 矢状-N 定档 400（SEED9 1.96→3.23；基础项隔离验证=0 最优）
  const kDLN = Number(e.SC_KD_LAT_N ?? e.SC_KD_LAT ?? kD), kDLP = Number(e.SC_KD_LAT_P ?? e.SC_KD_LAT ?? kD);
  const kDSN = Number(e.SC_KD_SAG_N ?? e.SC_KD_SAG ?? kD), kDSP = Number(e.SC_KD_SAG_P ?? e.SC_KD_SAG ?? kD);
  const cap = Number(e.SC_CAP ?? 300);  // ★ 单轴出力钳（原100=暗削标定：[108,200]全被切到100；抬到300——正式限幅交给预算审批链）
  const kTilt = Number(e.SC_KTILT ?? 0);   // 世界倾角回正增益 N·m/rad（默认0=关）
  const kCom = Number(e.SC_KCOM ?? 2500);  // CoM 误差回拉增益 N·m/m（基准）
  // ★ 整套参数含回拉：kCom 四方向独立（用户："一个方向修整套"）
  const kComLN = Number(e.SC_KCOM_LAT_N ?? kCom), kComLP = Number(e.SC_KCOM_LAT_P ?? kCom);
  const kComSN = Number(e.SC_KCOM_SAG_N ?? kCom), kComSP = Number(e.SC_KCOM_SAG_P ?? kCom);
  // ★ 2026-10-15 用户："预算要基于脚上的力、按力链真实情况时刻调整，不是随便填数"——
  //   实时物理口径：脚=实测 fz × 脚掌几何（侧向 CoP 半宽 / 矢状 半足长）；膝/髋=硬件额定（dof.tauMax 实测值）
  const budOn = String(e.SC_BUDGET ?? '1') !== '0';
  const fzS = ctx.sensors.feet[side === 'l' ? 0 : 1]!.fz;
  const copK = Number(e.SC_COPK ?? 0.7);   // CoP 可用比例（防脚翻滚留余量）
  const fw = Number(e.SC_FOOTW ?? 0.045);   // ★ 柔性足能力（用户："脚发力可以侧偏"）——但实测：松绑上限（0.12）在误差驱动踝控制器下反噬（0.18s<0.58s）→ 默认回 0.045，待踝控制器重设计（基础+CoP 混合）再启用
  const capFootLat = Math.max(15, fzS * fw * copK);      // 侧向：柔性足侧偏档（默认 12cm；SC_FOOTW=0.045 回刚性对照）
  const capFootSag = Math.max(15, fzS * 0.12 * copK);    // 矢状：半足长 ~12cm
  const kComSgn = Number(e.SC_KCOM_SGN ?? 1)
  const kSgn = Number(e.SC_KTILT_SGN ?? -1);   // 符号（可调）
  for (const [jn, ax] of AXES) {
    const di = ctx.body.dofByName(`${jn}_${side}`, ax);
    if (di < 0) continue;
    const d0 = ctx.body.dofs[di]!;
    const key = `${jn}_${side}:${ax}`;
    if (!_ref.has(key)) _ref.set(key, d0.angle);
    const dev = _ref.get(key)! - d0.angle;
    const dirN = ax === 0 ? dirState.latN : dirState.sagN;   // ★ 全局方向态（全链同套）
    // ★ 用户："抬腿过程的回正力不够抵消抬腿的力"——hold 档高增益在抬腿瞬态自激（膝2 ±200 翻号）
    //   → 抬腿段降档（SC_LIFT_GAIN；抬完恢复 hold 档）
    const gLift = isLiftDone() ? 1 : Number(e.SC_LIFT_GAIN ?? 1.0);   // ★ 抬腿降档实测伤（0.91 vs 6.97）→ 回 1；用户正解=躯干摆动侧减力（trunkClean 做）
    const aKp = gLift * (ax === 0 ? (dirN ? kPLN : kPLP) : ax === 2 ? (dirN ? kPSN : kPSP) : Math.min(kPLN, kPSN));
    const aKd = gLift * (ax === 0 ? (dirN ? kDLN : kDLP) : ax === 2 ? (dirN ? kDSN : kDSP) : Math.min(kDLN, kDSN));
    const outward = dev * d0.vel > 0;
    const damp = outward ? -aKd * d0.vel : 0;
    // ★ 用户："瞬间反作用交给回拉的力"——CoM 误差回拉，**按链分配**（用户："还有修"——原来全压髋0 一关节，膝/踝/脊柱全闲着）：
    //   髋0 .45 / 膝0 .15 / 踝0 .10 / 脊柱（trunkClean 取 .30，每节 .10）
    let tqCom = 0;
    if (sup && kCom !== 0) {
      const tgtC = (ctx.bal as unknown as { getComTarget?: () => { x: number; z: number } }).getComTarget?.() ?? { x: 0, z: 0 };
      // ★ 用户："我要把重心转过来（回读原处）"——回拉必须用 XcoM 误差（位置+速度/ω₀；只 P 项=纯减速拉不回来）
      // XcoM 速度项撤（预历史速度→首帧尖峰）；位置-only + 级联（SEED3 9.27 档）
      const ez = tgtC.z - ctx.sensors.com[2]!;
      const ex = tgtC.x - ctx.sensors.com[0]!;
      const rawLat = (dirState.latN ? kComLN : kComLP) * ez * kComSgn;
      const rawSag = (dirState.sagN ? kComSN : kComSP) * ex * kComSgn;
      const aD = 1 - Math.exp(-(1 / 240) / Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).SC_KCOM_TAU ?? 0.05));   // ★ 软起 τ 可调（0.2 拖累 SEED3 → 0.05）
      comDemand.lat += (rawLat - comDemand.lat) * aD;
      comDemand.sag += (rawSag - comDemand.sag) * aD;
      // ★ 生理分配（文献：侧向平衡=髋策略主导 Horak/Winter；臀中肌主力）——级联版实测伤（踝先吃满 CoP→脚边缘翻滚）
      //   髋 .45 / 膝 .15 / 踝 .10 / 脊柱 .30（trunkClean 取余）；总额仍走预算审批
      // ★ 用户："四个方向按人体用 CoM 权限"——
      //   侧向=髋策略主导（.45/.15/.10/.30，Horak/Winter）；矢状=**踝策略主导**（人体前后 CoP 权限大：先吃满踝再上提）
      // ★ 用户："com 权限，自下而上"——踝的 CoM 归 footPad 独占（clean 的踝份额=0，防双写跳脚）；
      //   髋取"扣掉踝 CoP 上限后"的余量；膝（韧带被动）/脊柱（末级代偿）不参与
      if (ax === 0) {
        // ★ 侧向最难（用户）：恢复躯干代偿份额（人体侧向靠躯干侧倾；脊柱=最后一段 CoM 权限）
        const aL = Math.max(-capFootLat, Math.min(capFootLat, comDemand.lat));
        const restL = comDemand.lat - aL;
        const spineL = Number(e.SC_LAT_SPINE_SH ?? 0) * restL;   // ★ 躯干份额实测伤（SEED5 0.69/SEED3 12→4.18）→ 默认 0（bottom-up 原样最优）
        if (jn === 'hip') tqCom = restL - spineL;
        comDemand.spineShare = spineL;
      } else if (ax === 2) {
        const aS2 = Math.max(-capFootSag, Math.min(capFootSag, comDemand.sag));
        if (jn === 'hip') tqCom = comDemand.sag - aS2;
        comDemand.spineShare = 0;
      }
    }
    // ★ 用户："回正需要改世界倾角了"——世界倾角回正（支撑腿；侧向轴吃 roll、矢状轴吃 pitch）
    let tqTilt = 0;
    if (sup && kTilt > 0) {
      const pit = ctx.sensors.torsoTilt[0]!, rol = ctx.sensors.torsoTilt[1]!;
      if (!_tref) _tref = [pit, rol];
      const dPit = pit - _tref[0], dRol = rol - _tref[1];
      if (ax === 0 && jn === 'hip') tqTilt = kSgn * kTilt * dRol;        // 每轴单一执行者（全关节摊=重复计数过驱）
      else if (ax === 2 && jn === 'hip') tqTilt = kSgn * kTilt * dPit;
    }
    // ★ 用户："基础力也要走预算"——全量（基础+增量）走实时预算；预算=min(力链容量, 硬件)
    const hw = d0.tauMax ?? 200;
    // ★ 基础力也按方向选（用户："一个方向修整套参数"——基础+回正全套）
    const baseN = Number(e[`SC_B0_${jn.toUpperCase()}${ax}_N`] ?? (B0[`${jn}${ax}`] ?? 0));
    const baseP = Number(e[`SC_B0_${jn.toUpperCase()}${ax}_P`] ?? (B0[`${jn}${ax}`] ?? 0));
    const baseDir = dirN ? baseN : baseP;
    const budget = Math.min(
      jn === 'foot' ? (ax === 2 ? capFootSag : capFootLat) : hw,
      hw,
    );
    const lim = budOn ? Math.min(cap, budget) : Math.min(cap, hw);
    const tau = Math.max(-lim, Math.min(lim, baseDir + aKp * dev + damp + tqTilt + tqCom));
    if (Math.abs(tau) < 0.5) continue;   // ★ 近零不写，让位给其他写手
    // （SKIP_FOOT 实验撤销：覆盖论已证伪；爬行真身=comKp 量纲太小）
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau, src: 'supportClean' });
  }
}
