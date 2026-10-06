/**
 * ══════════════════════════════════════════════════════════════════
 * supportLeg.ts —— **承重腿专责模块**（用户 2026-10-06 提案；设计 §21.14）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户：「**找为何后腿不能承重**。迈步系统也要权保证**后腿不后退、能真的支撑身体**。
 *   平衡保持系统也有权。**可能需要一个专门处理承重腿位置以及如何发力的模块**」
 *
 * 回读实证（`probe-slip`）：支撑腿全程**笔直**（髋 −2°、膝 −0°、踝 −1°），
 *   而 CoM 冲到 +197mm（脚在 x≈−70）⇒ **腿留在身后、不伸髋、不蹬踝**。
 *
 * 本模块的律：**静力映射** —— 给定地面反力（F_h, F_v）与目标 CoP，
 *   每个关节的力矩 = **地面反力对该关节的矩**（精确静力、无求解、不会抖）：
 *
 *     τ_j (矢状) = ∓[ F_v·(CoP − x_j) + F_h·y_j ]
 *
 *   符号按本 rig 的实测约定（`probe-copauth`：**负角 ⇒ CoP 前移**；
 *   `ANkle_COP` 律：`τ = +k·(CoP_obs − CoP_want)`）用 `SIGN_*` 开关标定。
 *
 * 与既有模块的关系：
 *   · ④c 的 `τ=JᵀF` 仍是**全链**（含脊柱）分配 —— 本模块输出**腿的那一份**，
 *     在 `sagJf` 之前写（同轴同系统相加，之后 ④c 若也写就叠加）；
 *   · **让位**与**承重声明**与 ④c 同规（`requestHold` + `loadBearing=true`）。
 *
 * 开关：`SUPLEG=0` 关（默认开）；`SUPLEGK` 水平增益；`SLSIGN_*` 标定符号。
 */
import type { RigState } from '../rigState';
import { envNum } from '../env';
import type { Ragdoll } from '../ragdoll';

const env = (): Record<string, string> =>
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};

export function supportLegTick(rs: RigState, doll: Ragdoll, ablate = ''): void {
  // ★ 必须接 `ablate`（门禁 B：「全消融 == 零输出」）——`supLeg` 是它的门名。
  const OFF = new Set(ablate.split(',').map((x) => x.trim()).filter(Boolean));
  /** 与 balance/step 同名的 `on('…')` 写法（门禁 A2 靠这个写法对账） */
  const on = (ch: string): boolean => !OFF.has(ch);
  if (!on('supLeg')) return;
  const plan = rs.copPlan;
  if (!plan || !plan.valid) return;
  const sup = rs.supportLeg();
  const jn = rs.sk.joints.map((j) => j.name);
  const jHip = jn.indexOf(`hip_${sup}`);
  const jKnee = jn.indexOf(`knee_${sup}`);
  const jAnk = jn.indexOf(`foot_${sup}`);
  if (jHip < 0 || jKnee < 0 || jAnk < 0) return;

  // 支撑载荷（原始，N）与水平力需求
  const side: 0 | 1 = sup === 'l' ? 0 : 1;
  // ★★★ Fv 的稳健来源（2026-10-06 实测：原取「原始 CoP 有效性」→ 瞬时 false 常发
  //   ⇒ 模块静默早退、`supLegTau ≡ 0` ——回读里"承τ=(0,0,0)"就是这个）。
  //   口径：优先原始力；无效时退到**载荷滤波 × 体重**（`loadFrac` 是同一份数据的低通）。
  const rawOk = rs.soleCopValid[side] === true && rs.soleCopFz[side]! > 15;
  const lf = sup === 'l' ? rs.loadFrac.l : rs.loadFrac.r;
  const Fv = rawOk ? rs.soleCopFz[side]! : lf * rs.sk.massTotal * 9.81;
  if (!(Fv > 40)) return;
  /** ★ 统一走 `envNum`（`Number('')` 坑本项目犯过 4 次，见 `core/env.ts`） */
  const num = (k: string, d: number): number => envNum(k, d);
  const kH = num('SUPLEGK', 1.0);
  const m = rs.sk.massTotal;
  const w0 = rs.omega0();
  const Fh = kH * (-m * w0 * w0 * plan.overX - 2 * m * w0 * 0.9 * rs.com.vx * 0.5);

  // 目标 CoP 与世界关节位
  const copT = plan.needX;
  const jw = new Float64Array(3);
  const pos = (j: number): { x: number; y: number } => { doll.jointWorld(j, jw); return { x: jw[0]!, y: jw[1]! }; };
  const pH = pos(jHip), pK = pos(jKnee), pA = pos(jAnk);

  // 静力矩：`M_j = F_v·(CoP − x_j) + F_h·(y_j − y_contact)`（contact y≈0）
  const M = (p: { x: number; y: number }): number => Fv * (copT - p.x) + Fh * p.y;

  // ★★★★★ 2026-10-06 **"通过脚发力来挺腰"**（用户：
  //   「**通过脚发力来实现腰挺起来我认为更能够修正 cop**」）：
  //   依据链：§22.13/22.48 三次证明「**腰只能力矩驱动、位置目标是死路**」；
  //   而 §22.51 证明 CoP 跳 ← 载荷跳 ← 支撑腿的力。
  //   ⇒ 把"挺腰"做成**支撑腿的伸髋/伸膝项**（由**实测折角**驱动）：
  //     折腰 ⇒ 腿伸展 ⇒ 盆骨抬起 ⇒ 躯干回直 ⇒ **同一条力同时修正 CoP**。
  //   折角 = `spine1..3/2` 之和（度，正 = 前折）；腿伸展 = 髋/膝的**反折方向**。
  //   `LEGFOLD=0` 关；`LEGFOLDK` 增益（N·m per 度）。
  // 扫描（真倒）：1.5→5.33 / **2→5.82** / 2.5→4.51 / 3→4.96 / 5→4.17 ⇒ 定稿 **2.0**
  // ★★★★★ 2026-10-06 **四向挺腰 + 预先 + 张力满即止**（用户：
  //   「**需要四个方向的挺腰**，而且**如果腿部的张力满了也不必脚步再发力了**。
  //     **还要预先挺腰**。**腰应该是强操控的**，不应该这么容易倒」）
  //   · 四向：矢状折角（`spine*/2` 之和）+ **侧向折角（`spine*/0` 之和）**，
  //     各接支撑腿对应的分量（矢状 → 髋/膝屈伸；侧向 → 髋**外展轴**）；
  //   · 预先：用折角的**变化率**（一拍差分，低通）⇒ "还没弯就先顶"；
  //   · 张力满即止：本模块算出的 τ **到 `TENSION_FULL` 比例就整体缩**
  //     （避免"腿已打满还在追"的饱和浪费）。
  const kLegFold = envNum('LEGFOLDK', 2.0, 0);
  // ⚠ 实测：`hip/0` 已被 LATPLAN/外展 CoP 占满，再加"侧向挺腰"**任何符号都更差**
  //   （±1/±2 全 5.79~6.17 vs 关 6.74）⇒ **默认 0**（机制保留；要接侧向得换执行器/先腾份额）。
  const kLatFold = envNum('LATFOLDK', 0, 0);
  const jrF = new Float64Array(3);
  let foldDeg = 0, foldLatDeg = 0;
  if (kLegFold > 0 || kLatFold > 0) {
    for (const nm of ['spine1', 'spine2', 'spine3']) {
      const jf = jn.indexOf(nm);
      if (jf < 0) continue;
      doll.jointRot(jf, jrF);
      foldDeg += jrF[2]! * (180 / Math.PI);
      foldLatDeg += jrF[0]! * (180 / Math.PI);
    }
  }
  // 预先：折角的**变化率**（一拍差分 + 0.08s 低通）——"还没弯就先顶"
  const kPreFold = envNum('PREFOLDK', 0.15, 0);
  if (foldDeg !== 0 || foldLatDeg !== 0) {
    const dtF = rs.dtCtrl > 1e-6 ? rs.dtCtrl : 1 / 60;
    const kf = Math.min(1, dtF / 0.08);
    rs.supFoldPrev = rs.supFoldPrev ?? { d: 0, l: 0, vd: 0, vl: 0 };
    const dFold = (foldDeg - rs.supFoldPrev.d) / dtF;
    const dLat = (foldLatDeg - rs.supFoldPrev.l) / dtF;
    rs.supFoldPrev.d = foldDeg; rs.supFoldPrev.l = foldLatDeg;
    rs.supFoldPrev.vd += (dFold - rs.supFoldPrev.vd) * kf;
    rs.supFoldPrev.vl += (dLat - rs.supFoldPrev.vl) * kf;
  }
  const foldRate = rs.supFoldPrev?.vd ?? 0;
  const latRate = rs.supFoldPrev?.vl ?? 0;
  const foldTau = -kLegFold * foldDeg - kPreFold * foldRate;          // 矢状（髋/膝伸展）
  const latFoldTau = -kLatFold * foldLatDeg - kPreFold * latRate;     // 侧向（髋外展轴向）

  // 符号标定（默认按"地面反力矩 → 马达力矩取负"）
  const sH = num('SLSIGN_HIP', -1), sK = num('SLSIGN_KNEE', -1), sA = num('SLSIGN_ANK', -1);
  // ★ 折角分量在髋/膝上的**分配**（原来是我拍的 1:−1，现参数化可扫）
  // 扫描（12s 真倒）：1.3→6.68 / **1.5→8.40** / 1.8→4.29；对照 1/0→6.47、0/−1→3.28
  //   ⇒ 挺腰分量**主要给髋**（1.5），膝只做反向平衡（−1）。定稿 1.5 / −1。
  const wH = envNum('FOLDW_H', 1.5, -3);
  const wK = envNum('FOLDW_K', -1, -3);
  const tauH = sH * M(pH) + foldTau * wH;    // ★ 挺腰分量（通过腿伸展）
  const tauK = sK * M(pK) + foldTau * wK;    //   膝的分量（系数可扫，原为 −1）
  const tauA0 = sA * M(pA);
  // ★★★★★ 2026-10-06 **用户算法：方向 → 足部区域发力（持续）**
  //   「**要前倒就前足多发力**，腰挺起来」。
  //   方向量：`plan.errX`（+ = CoP 要前移 = **前倒**）与 `plan.errZ`（+ = 往左）。
  //   本项**叠加**在静力映射之外，是一个**带速率限幅的持续偏置**
  //   （静力映射对上游 err 的逐拍抖动敏感 ⇒ 会翻号；速率限幅让它"认准方向、慢慢加"，
  //    这正是人"及时但持续地蹬"的形态 —— 而不是每拍换向的抖动）。
  const dirX = plan.errX;
  const sevX = Math.max(-1, Math.min(1, dirX / 0.08));      // 归一化（8cm ≈ 满）
  //   ⚠⚠ **实测净负**（真倒：+1.2→4.49 s、−1.2→5.61、−0.6→3.33、+0.6→5.70，
  //     基线 6.47 s）⇒ **默认 0（关）**。读法：静力映射里的 `CoP_t`（= 计划把 CoP
  //     钉在足缘）**已经隐含**"前倒→前足发力"的力矩；再叠一项就是**双计**，
  //     反而把力链推离平衡。开关保留供未来"替换而非叠加"的整定。
  const kToe = num('TOEK', 0);                              // N·m / 单位严重度（×Fv 归一）
  const tauToeWant = kToe * sevX * (Fv / 400);              // 前倒 sevX>0 ⇒ 正（前足蹬）
  const slewT = num('TOESLEW', 6);                          // N·m / 控制拍（速率限幅）
  const dT = Math.max(-slewT, Math.min(slewT, tauToeWant - rs.supLegToe));
  rs.supLegToe += dT;
  const tauA = tauA0 - rs.supLegToe;   // 踝的符号约定：正 τ = CoP 后移 ⇒ 前足蹬取**负**

  // 让位（位置环只留阻尼；力矩是唯一承重路径）+ 承重声明
  rs.requestHold(jHip, 2, 'balance', '承重腿·让位');
  rs.requestHold(jKnee, 2, 'balance', '承重腿·让位');
  rs.requestHold(jAnk, 2, 'balance', '承重腿·让位');
  // ★ 侧向折角 → 髋**外展轴（HIP_ABD_AXIS=0）**；张力满即止：三轴总量封顶 `TENSION_FULL`
  const HBA = 0;
  if (Math.abs(latFoldTau) > 0.05) {
    const tmaxA = rs.sk.joints[jHip]!.maxTorque[HBA] ?? 120;
    const tf = Math.max(-tmaxA, Math.min(tmaxA, latFoldTau));
    rs.requestTorque(jHip, HBA, tf, 'balance', '承重腿·侧向挺腰', true);
  }
  const tFull = envNum('TENSION_FULL', 1.0, 0.05, 1.0);
  for (const [j, t] of [[jHip, tauH], [jKnee, tauK], [jAnk, tauA]] as const) {
    // ★ 张力满即止：若该轴**已由其它写者顶到 τmax 的 `tFull` 倍**，本模块不再加
    const tNow = Math.abs(doll.tauApplied[j * 3 + 2] ?? 0);
    const tmax0 = rs.sk.joints[j]!.maxTorque[2] ?? 120;
    if (tNow >= tmax0 * tFull) continue;
    const tmax = rs.sk.joints[j]!.maxTorque[2] ?? 120;
    // ★ 份额（§22.54）：承重腿静力与 JᵀF 重叠 ⇒ 只拿小份（默认 40）
    const share = envNum('SHARE_SUP', 1e9, 0);   // 默认不限制（份额实测更差，见 balance.ts）
    const tc = Math.max(-Math.min(tmax, share), Math.min(Math.min(tmax, share), t));
    if (Math.abs(tc) > 0.05) rs.requestTorque(j, 2, tc, 'balance', '承重腿·静力', true);
  }
  rs.supLegTau = { hip: tauH, knee: tauK, ank: tauA, Fh, Fv };
  void pH; void pK;
}
