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
import { envOn } from '../env';
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
  /** ★ 整装替换总门（默认开 = 本模块为唯一姿势出口；`ONESYS=0` 回退分散式） */
  const onesys = envOn('ONESYS', true);
  const kH = num('SUPLEGK', 1.0);
  const m = rs.sk.massTotal;
  const w0 = rs.omega0();
  // ══════════════════════════════════════════════════════════════
  // ★★★★★ 2026-10-06 **协同库·激活层**（§22.62 文献定案：
  //   CNS 用 4~5 个**力向量协同**、激活量是**标量**；本项目 §22.49 实测
  //   "唯一有效的形态 = 低频量驱动 + 速率限幅积分"）。
  //   本项把剪力从**逐拍直通的 `wantFh`** 变成**持续激活量 `synFh`**：
  //     每拍 `synFh ← synFh + clamp(wantFh − synFh, ±SYNSLEW)`（`SYNSLEW` 大 = 不退化为直通）
  //   这是"一个机制"的**组织形态**：同一份物理（`overX` + `vx`），
  //   但不再每拍翻号（实测 `vx` −30→+87→+38→+11）。
  //   `SYNTAU=0` 关（回退直通）。
  const wantFh = -m * w0 * w0 * plan.overX - 2 * m * w0 * 0.9 * rs.com.vx * 0.5;
  // ⚠⚠ 实测（12s 真倒）：0→8.40（直通）｜0.2→7.06｜0.5→5.87 ⇒ **平滑反而更差**！
  //   ⇒ 本激活层**默认关**（`SYNTAU=0`）。读数：现有直通 `Fh` 本身就在正收益区间，
  //     §22.49 的"低频持续"是**哪些通道值得存在**的判据，不是"把已有通道平滑"的配方。
  const synTau = num('SYNTAU', 0);
  if (synTau > 0) {
    const dtS = rs.dtCtrl > 1e-6 ? rs.dtCtrl : 1 / 60;
    const kS = Math.min(1, dtS / synTau);
    rs.synFh += (wantFh - rs.synFh) * kS;
  } else {
    rs.synFh = wantFh;
  }
  // ★ 整装替换补件③：**spill 的剪力份额**（逐通道回开 +0.48）。
  //   分散式是**两份**（spill 进 `wantedForce.F` 一份 + 本模块 `overX` 一份）；
  //   唯一模块下只剩一份 ⇒ 用 `SYN_SPILL`（默认 1 = 补回第二份）恢复叠加量。
  // ⚠ 实测：补回双计后 ONESYS 4.81→**3.25**（更差）⇒ 默认 0。读法：spill 的收益
  //   依赖它经 `wantedForce.F → ④c JᵀF` 的**第二条路径**；并进同一出口只是加力不加路。
  const synSpill = onesys && envOn('SYN_SPILL', false) ? 1 : 0;
  const Fh = kH * rs.synFh + synSpill * (-m * w0 * w0 * plan.overX - 2 * m * w0 * 0.9 * rs.com.vx * 0.5);
  rs.synFhWant = wantFh;

  // ══════════════════════════════════════════════════════════════
  // ★★★★★ 2026-10-06 **整装替换：本模块 = 唯一姿势模块**（用户：
  //   「**我想让一个模块干多种活，而不是多个模块同时发力**」；文献 §22.62：
  //   CNS 用 4~5 个**力向量协同**。）
  //   本块 = **侧向力向量**（第 4 个协同）：直接用 balance 已算好的
  //   `rs.wanted.comp.lateral`（= `m·h·aDesZ`，含死区/限幅的**验证过的律**），
  //   不再自造第二套。执行：髋**外展轴**（`hip/0`）+ 踝额状（`foot/0`）——
  //   `ONESYS=1` 时 ⑤ 停写 ⇒ 这两根轴**腾出来**给本模块（此前"加不上"的根因）。
  // ⚠ 侧向只能在 **ONESYS=1**（⑤ 已停写、`hip/0` 腾出来）时接管；
  //   否则与 LATPLAN/⑤ 双计（实测默认下开它 8.40→5.28）。
  // 重标定扫描（最长挺直窗/稳住窗/末帧折角）：0.7→1.73/1.49｜1.0→1.89/1.64/1.9°
  //   ｜**1.05→1.78/1.78/4.0°**｜1.1→1.63/1.59/1.7°｜1.15→2.18/1.60/**46.8°**（折腰换窗口，已识破）
  //   ｜1.2/1.25/1.3→1.70/2.31/2.29（稳态差）
  //   ⇒ **定稿 1.05**：复合口径（min 1.64→1.78、sum 3.53→3.56）最优，末帧折角 4.0° 仍在规范内。
  const Fhz = onesys ? envNum('SYN_LATK', 1.05, 0) * (rs.wantF?.fz ?? 0) : 0;
  // ══════════════════════════════════════════════════════════════
  // ★★★★★ 2026-10-06 **论文技术细节 △-1：力挂"腿轴坐标系"**
  //   （Torres-Oviedo 2006 原文：*"Forces were reconstructed only when referenced
  //    to a coordinate system that **rotated with the limb axis** as stance distance
  //    changed."*；用户：「**按照论文来就行**」）
  //
  //   实现：支撑腿的世界腿轴 `u` = 髋→踝 单位向量；其正交系 `v`。
  //   · 期望地面反力（世界系的 `Fh` 水平 + `Fv` 竖直）**投影到腿轴系**，
  //     得到 `F_u`（沿腿）/ `F_v`（垂直腿）—— 控制量的语义从此绑定肢体姿态，
  //     这正是论文强调的不变量；
  //   · **力矩是几何量，与坐标系选择无关**（`r×F` 在任何一致系里同值），
  //     所以执行层数值不变 —— 改的是**参考系约定**（论文要求的"名"）。
  //   · `LIMBFRAME=0` 回退（A/B，验证同值性）。
  const useLimb = envOn('LIMBFRAME', true);
  let copT = plan.needX;
  const jw = new Float64Array(3);
  const pos = (j: number): { x: number; y: number } => { doll.jointWorld(j, jw); return { x: jw[0]!, y: jw[1]! }; };
  const pH = pos(jHip), pK = pos(jKnee), pA = pos(jAnk);

  // 静力矩：`M_j = F_v·(CoP − x_j) + F_h·(y_j − y_contact)`（contact y≈0）
  // ★ 腿轴系版（论文 △-1）：把 `(Fh, Fv)` 先投影到腿轴系 (F_u, F_v_perp)，
  //   力臂也换到同系 ⇒ 数学恒等；差异只在**数值浮点路径**与 `copT` 的语义。
  const M = (p: { x: number; y: number }): number => {
    if (!useLimb) return Fv * (copT - p.x) + Fh * p.y;
    const ux = pA.x - pH.x, uy = pA.y - pH.y;
    const uLen = Math.hypot(ux, uy) || 1;
    const u = { x: ux / uLen, y: uy / uLen };            // 世界系腿轴
    const vp = { x: -u.y, y: u.x };                       // 正交
    const Fu = Fh * u.x + Fv * u.y;                       // 沿腿
    const Fv2 = Fh * vp.x + Fv * vp.y;                    // 垂直腿
    // 力臂 = **接触点(CoP, y≈0) − 关节**（与世界版同参考点：`M = r×F` 的 z 分量）
    const rx = copT - p.x, ry = -p.y;
    const rU = rx * u.x + ry * u.y;
    const rV = rx * vp.x + ry * vp.y;
    return rU * Fv2 - rV * Fu;                            // = Fv·(copT−p.x) + Fh·p.y（恒等）
  };

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
  // ★★★★★ 整装替换补件：**CoP 积分追随**（原 `ANKLE_COP` 的律，收编进唯一模块）。
  //   静力映射的 `M(pA)` 是**瞬时**的；原 `ankle_CoP` 是**积分**（τ_prev + k·err·Fz，限速率）
  //   —— 消融证明它承重（8.40→3.17），所以唯一模块必须**原样带上**它，
  //   否则替掉它 = 丢动态（实测 ONESYS 首版 3.11s 的主因）。
  //   `SYN_COP=0` 关（回退瞬时 M(pA)）。
  let tauA0 = sA * M(pA);
  // ★★★★★ 整装替换补件②：**VIP 踝弹簧**（原 `balance` 的第⑥块；逐通道回开实测
  //   它是唯一模块**最大缺口**：ONESYS 3.73 → 加回它 5.26（+1.53s，其余三条各 +0.35~0.48）。
  //   律（`balance.ts` 第⑥块，Loram & Lakie 2002「内禀踝刚度」/ Maus 2010 虚拟支点）：
  //     `q_vip = atan2(com.x − 踝x, com.y − 踝y)`（重心绕踝的倾角）
  //     `τ_踝 = kVip·q_vip − cVip·q̇_vip`，`cVip = 2ζ√(k·I_绕踝)`（平行轴定理实算）
  //   —— 这本身就是"**踝一根弹簧独力做 CoM 调整**"的形态，正是用户要的"一个机制多作用"。
  if (onesys && envOn('SYN_VIP', true)) {
    const ax = pA.x, ay = pA.y;
    const dxv = rs.com.x - ax, hv = Math.max(0.2, rs.com.y - ay);
    const qVip = Math.atan2(dxv, hv);
    const qVipRate = (hv * rs.com.vx - dxv * rs.com.vy) / (dxv * dxv + hv * hv);
    const kVip = envNum('VIPK', 270, 0);
    const zVip = envNum('VIPZ', 0.9, 0);
    const iAnk = Math.max(1e-4, doll.inertiaAboutJoint(jAnk));
    const cVip = 2 * zVip * Math.sqrt(kVip * iAnk);
    const tauVip = kVip * qVip - cVip * qVipRate;
    const mxV = rs.sk.joints[jAnk]!.maxTorque[2] ?? 120;
    tauA0 += Math.max(-mxV, Math.min(mxV, tauVip) * 0);   // 先只算不写（对照用）
    rs.synVipTau = tauVip;
    if (Math.abs(tauVip) > 0.05) {
      rs.requestTorque(jAnk, 2, Math.max(-mxV, Math.min(mxV, tauVip)), 'balance', '唯一姿势·踝VIP弹簧', true);
    }
  }
  if (onesys && envOn('SYN_COP', true)) {
    const sideIdx: 0 | 1 = sup === 'l' ? 0 : 1;
    const copOk = rs.soleCopValid[sideIdx] === true && rs.soleCopFz[sideIdx]! > 20;
    if (copOk && Number.isFinite(rs.soleCopX[sideIdx]!)) {
      const kCop = envNum('COPK', 0.5, 1e-12);
      const dTau = kCop * (rs.soleCopX[sideIdx]! - copT) * rs.soleCopFz[sideIdx]!;
      const slew = envNum('COPSLEW', 12, 0);
      const dClamp = Math.max(-slew, Math.min(slew, dTau));
      rs.ankCopTau = (rs.ankCopTau ?? 0) + dClamp;
      const mx = rs.sk.joints[jAnk]!.maxTorque[2] ?? 120;
      rs.ankCopTau = Math.max(-mx, Math.min(mx, rs.ankCopTau));
      tauA0 = rs.ankCopTau;   // 接管：用积分值（不再是瞬时的 M(pA)）
    }
  }
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
  // ── 侧向力向量的执行（髋外展 + 踝额状，同一静力映射的形式）──
  if (Math.abs(Fhz) > 0.5) {
    const jHipA = jHip, jAnkA = jAnk;
    const HBA = 0;
    const pHy = pH.y, pAy = pA.y;
    const tHipL = Fhz * pHy;    // 侧向力对髋的矩（臂 = 竖直距离）
    const tAnkL = Fhz * pAy;
    const mxH = rs.sk.joints[jHipA]!.maxTorque[HBA] ?? 120;
    const th = Math.max(-mxH, Math.min(mxH, tHipL));
    if (Math.abs(th) > 0.05) rs.requestTorque(jHipA, HBA, th, 'balance', '唯一姿势·侧向(髋外展)', true);
    const mxA = rs.sk.joints[jAnkA]!.maxTorque[0] ?? 60;
    const ta = Math.max(-mxA, Math.min(mxA, tAnkL));
    if (Math.abs(ta) > 0.05) rs.requestTorque(jAnkA, 0, ta, 'balance', '唯一姿势·侧向(踝额状)', true);
    rs.synLatTau = { hip: th, ank: ta, Fz: Fhz };
  }

  // ══════════════════════════════════════════════════════════════
  // ★★★★★ **整装替换总门 `ONESYS`**：本模块 = 唯一姿势模块时，
  //   balance 的 ④c(矢状JᵀF)/⑤(侧向)/⑥(踝VIP+ANKLE_COP)/spill 全部停写
  //   （由 controller 读同一环境变量跳过），腿/髋/踝的力矩**只有这一个出口**。
  //   本模块已有的全套活：支撑载荷(Fv)+矢状刹车(Fh)+侧向(Fhz)+CoP(needX)
  //   +挺腰(折角→伸展)+让位+承重+张力满即止。

  // ══════════════════════════════════════════════════════════════
  // ★★★★★ 2026-10-06 **S1 表层后线（superficial back line）** —— §21.16.3 施工
  //   文献：足底筋膜→腓肠肌→腘绳→骶结节韧带→**竖脊肌**（同侧串联；
  //   Pool-Goudzwaard/Vleeming 1998 的 force closure；Wilke 2016/17 张力传导实证）。
  //   形态纪律（三条，全部有实测依据）：
  //     ① **只走力矩出口**（§22.13/22.48："腰只能力矩驱动"，位置目标 4 次否证）；
  //     ② **低频持续**（§22.49：唯一有效形态；吊索张力本是等长持续量）→ 0.10s 低通；
  //     ③ **速率限幅**（§22.21：防脊柱被甩）。
  //   输入（不新造信号）：本模块已算的**蹬伸力** `|tauH·wH| + |tauK·wK|`（归一化）。
  //   输出：`spine1/2` + `spine2/2`（腰椎段）的伸张力矩。
  //   `SLING_SBL=0` 关（默认）；`SIGN_SBL` 标定符号（本项目栽过多次正负）。
  // 扫描（站立窗/稳住窗/真倒）：K=2→(1.88/–/3.43)｜**K=4→(1.28/1.25★/5.28)**｜
  //   K=5→(0.98✗/0.63/3.40，腰折 30.6°)｜K=6→3.22｜K=8→2.82
  //   ⇒ **定稿 K=4.0**（窗口窄，属共振型灵敏度——本项目常见）。
  const sblK = envNum('SLING_SBL', 4.0, 0);
  if (sblK > 0) {
    const pushEffort = (Math.abs(tauH * wH) + Math.abs(tauK * wK))
      / Math.max(1, rs.sk.massTotal * 9.81 * 0.35);       // ≈1 = 满蹬
    const dtS1 = rs.dtCtrl > 1e-6 ? rs.dtCtrl : 1 / 60;
    const kS1 = Math.min(1, dtS1 / 0.10);
    rs.sblDrive += (pushEffort - rs.sblDrive) * kS1;      // 低频持续
    // 符号标定（实测）：+1→(0.96s ✗/3.60)；**−1→(1.28s ★/5.28)** ⇒ 定稿 −1。
    const sgnS = envNum('SIGN_SBL', -1, -1);
    const slewS = envNum('SBL_SLEW', 8, 0);               // N·m / 控制拍
    rs.sblTau += Math.max(-slewS, Math.min(slewS, sgnS * sblK * rs.sblDrive - rs.sblTau));
    for (const nm of ['spine1', 'spine2']) {
      const js = jn.indexOf(nm);
      if (js < 0) continue;
      const mxS = (rs.sk.joints[js]!.maxTorque[2] ?? 120) * 0.5;
      const tS = Math.max(-mxS, Math.min(mxS, rs.sblTau));
      if (Math.abs(tS) > 0.05) rs.requestTorque(js, 2, tS, 'balance', '吊索·表层后线(SBL)', true);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ★★★★★ 2026-10-06 **S2 force closure（骶髂压缩）** —— §21.16.4
  //   文献（Pool-Goudzwaard/Vleeming 1998）：负荷从脊柱到骨盆必经骶髂，
  //   稳定 = form closure + **force closure**（肌肉/筋膜/韧带的**压缩**）。
  //   落地：支撑载荷越大 ⇒ 骨盆/腰椎的**背景张力**越大（等长压缩）。
  //   输入（不新造）：双腿载荷和 `loadFrac.l + loadFrac.r`（1.0 = 全重）；
  //   输出：`spine1/2`（腰椎根段）的**伸张力矩**（走力矩出口，与 SBL 同轴相加）；
  //   形态：低频持续 + 速率限幅（同 S1）。
  //   `SLING_FC=0` 关（默认）；`SIGN_FC` 标定。
  // 扫描（最长挺直窗/稳住窗/真倒）：**K=20→(1.73★/0.97/4.83)**｜K=30→(1.56/0.82/4.46)
  //   ｜K=50→(1.49/1.21/3.62)｜关→(1.28/1.25/5.28)｜K=10 直接✗
  //   ⇒ 按 §21.16.5 **主指标（最长挺直窗）定稿 K=20**；取舍（稳住窗/真倒略降）已记档 §22.69。
  const fcK = envNum('SLING_FC', 20, 0);
  if (fcK > 0) {
    // ⚠ 第一版用 `loadFrac 之和`：实测它≈**常数 1.0**（就是体重）⇒ 退化成常数偏置，
    //   ±两向都掉（站立窗 1.28→0.99/0.80）。文献语义是"**不对称/扰动下**的自我锁紧"
    //   （self-bracing）⇒ 改用**左右载荷差**（单支撑/扰动时才大）。
    const loadSum = Math.abs((rs.loadFrac.l ?? 0) - (rs.loadFrac.r ?? 0));
    const dtS2 = rs.dtCtrl > 1e-6 ? rs.dtCtrl : 1 / 60;
    const kS2 = Math.min(1, dtS2 / 0.15);
    rs.fcDrive += (loadSum - rs.fcDrive) * kS2;
    // 符号：+1→1.73★；−1→✗（3.33）⇒ 定稿 +1。
    const sgnF = envNum('SIGN_FC', 1, -1);
    const slewF = envNum('FC_SLEW', 6, 0);
    rs.fcTau += Math.max(-slewF, Math.min(slewF, sgnF * fcK * rs.fcDrive - rs.fcTau));
    const js = jn.indexOf('spine1');
    if (js >= 0) {
      const mxF = (rs.sk.joints[js]!.maxTorque[2] ?? 120) * 0.5;
      const tF = Math.max(-mxF, Math.min(mxF, rs.fcTau));
      if (Math.abs(tF) > 0.05) rs.requestTorque(js, 2, tF, 'balance', '吊索·force closure', true);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ★★★★★ 2026-10-06 **S3 后功能线（back functional line）** —— §21.16.3
  //   文献：**背阔肌 ↔ 胸腰筋膜 ↔ 对侧臀大肌**（解剖链；Pool-Goudzwaard/Vleeming 1998
  //   的 force closure 的力学主体之一；Wilke 2016/17 张力传导）。
  //   与 S1 的本质区别：**对角**——右腿蹬 ⇒ **左躯干**张力（步态里的交叉耦合）。
  //   落地（脊柱在中线，对角进脊柱即"**按支撑侧翻号的侧向**"）：
  //     `spine1/0 + spine2/0 的 τ = sgn_side · SLING_BFL · 蹬伸量(低频持续)`
  //     `sgn_side = (sup==='l' ? +1 : −1) · SIGN_BFL`
  //   形态：力矩出口 + 复用 S1 的 `rs.sblDrive`（已 0.10s 低通）+ 同款速率限幅。
  //   `SLING_BFL=0` 关（默认）；`SIGN_BFL` 标定（±）。
  const bflK = envNum('SLING_BFL', 0, 0);
  if (bflK > 0) {
    const sideS = (sup === 'l' ? 1 : -1) * envNum('SIGN_BFL', 1, -1);
    const slewB = envNum('BFL_SLEW', 6, 0);
    rs.bflTau += Math.max(-slewB, Math.min(slewB, sideS * bflK * rs.sblDrive - rs.bflTau));
    for (const nm of ['spine1', 'spine2']) {
      const js = jn.indexOf(nm);
      if (js < 0) continue;
      const mxB = (rs.sk.joints[js]!.maxTorque[0] ?? 72) * 0.5;
      const tB = Math.max(-mxB, Math.min(mxB, rs.bflTau));
      if (Math.abs(tB) > 0.05) rs.requestTorque(js, 0, tB, 'balance', '吊索·后功能线(BFL)', true);
    }
  }

  rs.supLegTau = { hip: tauH, knee: tauK, ank: tauA, Fh, Fv };
  void pH; void pK;
}
