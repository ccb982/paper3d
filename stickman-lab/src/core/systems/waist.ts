/**
 * ══════════════════════════════════════════════════════════════════
 * ④′  systems/waist.ts —— **腰（脊柱）的唯一发布者**（2026-10-06 重构）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户定调（本节所有设计的唯一依据）：
 *   「**本来就没站起来，一直是折腰状态的**。我觉得还是**腰部借力让腰挺起来**概率大点」
 *   「**是腿部发力，然后腰部借力才对**」
 *   「**平衡系统和迈步系统都走腰部借力才对**」
 *
 * 为什么要独立成一个模块（`架构_v2_三模块协作.md` §22.12.2 的根因）：
 *   **脊柱的目标原先只在"迈步的关键帧分支"里存在** ⇒ 迈步一停手就没人写
 *   ⇒ `axisOwner = bind` ⇒ 位置伺服抱着"上一拍的目标" ⇒ 躯干被动力学自由推折。
 *   实测（`probe-domain` 姿态列）：**七条用例全部** `pitch ≈ −92°`、上身 CoM 18cm
 *   —— 每一笔"12.00s 不倒"都是**折着腰趴满**的。
 *   ⇒ 结论：脊柱必须有一个**永远存在的发布者**，不管迈步/平衡说什么。
 *
 * ★★★ 三条设计原则
 *
 *   ① **永远有目标**。本模块每拍都给 `spine1/2/3` 的 3 个轴写 `requestAngle`
 *      （不是 `acorr` 增量 —— 增量只在"目标存在"时才有意义，而那正是缺口）。
 *      ⇒ 脊柱的 `axisOwner` 永远不是 `bind`。
 *
 *   ② **借力 = 从腿的实测力里取，不由任一系统自说自话**。
 *      `lean = kSum · GRF_水平 / (m·g)`，其中 `kSum = step.gain + bal.gain`。
 *      两个系统只设**自己的增益**，方向与合力由**同一处**算
 *      ⇒ 不会"各按各的相位借、互相抵消"（那是"重心转移拉不回来"的结构原因）。
 *      ⚠ **只借指向目标的那个分量**（`max(0, F·dir)`）—— 稳定性关键：
 *        把 `grfZ` 无整流地反馈进腰部倾角，而 `grfZ` 又是 CoM 运动的结果，
 *        就构成**正反馈自激**（倾得越多 ⇒ 推得越多 ⇒ 倾得越多）。
 *
 *   ③ **合成 = 基准 + 迈步名义 + 借力 + 平衡修正**，逐项可回读、可单独消融。
 *
 * 消融名：`waist`（整块不跑 ⇒ 回退 `bind`，用于对照"永远有目标"值多少）。
 */
import type { RigState } from '../rigState';
import { jointIndexByName } from '../skeleton';

const DEG = Math.PI / 180;

export interface WaistParams {
  /** 总开关（关 ⇒ 等同消融 `waist`） */
  enabled?: boolean;
  /** **基准姿态**（度，域口径 正=屈）—— "把腰竖直"的那一项。0 = 静姿态 */
  basePitchDeg?: number;
  baseRollDeg?: number;
  baseYawDeg?: number;
  /** 借力倾角上限（度） */
  leanMaxDeg?: number;
  /** **借力总增益**：腿的水平 GRF ⇒ 腰部倾角（无量纲；0 = 不借力） */
  borrowK?: number;
  /** 斜率限制（度/控制拍）—— 防抖，实测不加会打崩 */
  slewDegPerTick?: number;
  /** 每个脊柱关节分到的比例（3 个关节 ⇒ 默认 1/3） */
  stagger?: number;
  /** 消融（逗号分隔）：`waist` = 整块不跑 */
  ablate?: string;
}

export const DEFAULT_WAIST_PARAMS: WaistParams = {
  enabled: true,
  basePitchDeg: 0,
  baseRollDeg: 0,
  baseYawDeg: 0,
  leanMaxDeg: 12,
  borrowK: 0,
  slewDegPerTick: 3,
  stagger: 1 / 3,
};

const SPINE = ['spine1', 'spine2', 'spine3'] as const;

/**
 * 腰部一拍：读两个系统的**意图** + 腿的**实测力** ⇒ 发布脊柱的 3 轴目标。
 *
 * 调用点：`controller.step`，**在 `stepSystem` 与 `balanceSystem` 之后、`arbitrate` 之前**
 *   （顺序即依赖：两个系统先填意图，本模块再统一发布）。
 */
export function waistSystem(rs: RigState, p: WaistParams = DEFAULT_WAIST_PARAMS): void {
  const OFF = new Set((p.ablate ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  /** 与 `balance.ts`/`step.ts` **同名同义**的消融门（轴归属门禁 A2 靠 `on('…')` 这个写法对账） */
  const on = (ch: string): boolean => !OFF.has(ch);
  if (p.enabled === false || !on('waist')) {
    // ★ 消融/关闭时**必须显式记账**（不静默）：读回端要能区分"没发布"与"发布了 0"
    rs.waist.published = 0;
    rs.waist.kSum = 0;
    return;
  }
  rs.waist.published = 1;

  const w = rs.waist;
  const base = {
    pitch: p.basePitchDeg ?? 0,
    roll: p.baseRollDeg ?? 0,
    yaw: p.baseYawDeg ?? 0,
  };

  // ── ① 源：腿的**实测水平 GRF**（已在力链层做过 80ms 低通，信噪比 ≈ 10）──
  const gc = rs.groundChain;
  w.grfX = gc ? gc.grfX : 0;
  w.grfZ = gc ? gc.grfZ : 0;

  // ── ② 借力：只借**指向目标**的分量（防正反馈自激，见文件头 ②）──
  const kSum = (w.step.gain ?? 0) + (w.bal.gain ?? 0);
  w.kSum = kSum;
  const leanMax = (p.leanMaxDeg ?? 12) * DEG;
  const bodyN = Math.max(1, rs.massN);
  const borrowK = (p.borrowK ?? 0) * kSum;
  // 方向：朝**承接腿**（步态里承重要交接过去的那条腿）
  const recv = rs.roleRecv ?? rs.frontLeg();
  const dirZ = Math.sign((recv === 'l' ? rs.soleZ.l : rs.soleZ.r) - rs.com.z);
  const dirX = Math.sign((recv === 'l' ? rs.soleX.l : rs.soleX.r) - rs.com.x);
  const helpZ = dirZ === 0 ? 0 : Math.max(0, w.grfZ * dirZ);
  const helpX = dirX === 0 ? 0 : Math.max(0, w.grfX * dirX);
  const bRoll = Math.max(-leanMax, Math.min(leanMax, (borrowK * helpZ) / bodyN));
  const bPitch = Math.max(-leanMax, Math.min(leanMax, (borrowK * helpX) / bodyN));
  w.borrow.pitch = bPitch / DEG;
  w.borrow.roll = bRoll / DEG;

  // ── ③ 合成（度）：基准 + 迈步名义 + 借力 + 平衡修正 ──
  const tgt = {
    pitch: base.pitch + (w.step.pitch ?? 0) + (bPitch / DEG) + (w.bal.pitch ?? 0),
    roll: base.roll + (w.step.roll ?? 0) + (bRoll / DEG) + (w.bal.roll ?? 0),
    yaw: base.yaw + (w.step.yaw ?? 0),
  };

  // ── ④ 斜率限制：逐轴（度/拍 → 度/秒的等价由调用频率决定）──
  const maxStep = p.slewDegPerTick ?? 3;
  const slew = (v: number, prev: number): number => {
    const d = v - prev;
    return Math.abs(d) > maxStep ? prev + Math.sign(d) * maxStep : v;
  };
  const oPitch = slew(tgt.pitch, w.out.pitch);
  const oRoll = slew(tgt.roll, w.out.roll);
  const oYaw = slew(tgt.yaw, w.out.yaw);
  w.out.pitch = oPitch; w.out.roll = oRoll; w.out.yaw = oYaw;

  // ── ⑤ 发布：3 个脊柱关节 × 3 轴（目标，不是增量）──
  const st = p.stagger ?? 1 / 3;
  for (const nm of SPINE) {
    const j = jointIndexByName(rs.sk, nm);
    if (j < 0) continue;
    rs.requestAngle(j, 2, oPitch * st * DEG, 'balance', '腰部·矢状(基准+借力+修正)');
    rs.requestAngle(j, 0, oRoll * st * DEG, 'balance', '腰部·额状(基准+借力+修正)');
    rs.requestAngle(j, 1, oYaw * st * DEG, 'balance', '腰部·扭转(迈步名义)');
  }
  // 诊断（`probe-waist` / UI 逐帧回读）
  rs.ubTau = Math.hypot(oPitch, oRoll);
}
