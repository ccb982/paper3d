/**
 * ══════════════════════════════════════════════════════════════════════
 * ★★★ 模块 ①：**承重腿 + 腰的平衡维持系统**（用户 2026-10-02 的两个模块之一）
 * ══════════════════════════════════════════════════════════════════════
 *
 *   "我的设计分两个模块，一个承重腿和腰的平衡维持系统，另一个迈步系统"
 *
 *   本文件只负责一件事：**给定"哪条腿在承重"，算出三个平面上各关节该出多少力矩，
 *   使全身 CoM 停在那条腿上方**。它**不知道**摆动腿要抬多高、脚要落在哪——
 *   那是 `stepSystem.ts` 的事。两个模块唯一的接口是"当前承重腿是谁"和
 *   "这次抬腿许可有没有"。
 *
 *   ────────────────────────────────────────────────────────────────────
 *   平面分工（全部有文献依据，不是拍脑袋）：
 *
 *   | 平面 | 主执行器 | 机制 | 文献 |
 *   |---|---|---|---|
 *   | 矢状面 | 踝（CoP 策略） | VIP：踝↔CoM 虚拟摆的摆角 = CoP 位置 | Morasso et al., Front Comput Neurosci 2022, 15:956932 |
 *   | 矢状面 | 髋（CoM 策略） | 超临界被动刚度，踝饱和时接管 | 同上；K_crit = mgh |
 *   | 额状面 | 髋外展 ↔ 踝内/外翻 | VMP + 额状面力学链 | Liu et al., J Biomech 2012 |
 *   | 躯干 | **被动，指令恒 0** | 高惯量，来不及参与快速调整 | Riemann et al., Arch Phys Med Rehabil 2003, 84 |
 *
 *   ────────────────────────────────────────────────────────────────────
 *   **两条必须记住的实测结论**（本项目已四次独立确认）：
 *
 *   ① **踝在本 rig 里没有 CoP 权限**。`kCop` 踝指令放大 ×33、`ankleTorque`
 *      上限放大 ×9、VIP 踝刚度比 ×3.7 —— 三种测法结果**逐位相同**。
 *      ⇒ 矢状面 VIP 目前**推不动 CoM**，必须由髋接管（`kWtX`）。
 *   ② **躯干在平衡相必须静默**。此前 `spineSync` 被误设为三相全开，
 *      单腿保持平衡时腰仍收到 −14° 指令，给本就不稳的系统又加一个大惯量扰动。
 *      Riemann 2003 明确："The **trunk**... appeared to be the **least important**
 *      source of corrective action"。⇒ 平衡相 `spineCmd ≡ 0`。
 */

/** 单腿站立时 CoP 行程半长（m）：踝到跖骨头/足跟。Sci Rep 2025 的 metatarsal CoP 限制 */
export const COP_HALF_LEN = 0.075;
/** 额状面 CoP 行程 = 单脚半宽（支撑面从双脚缩到一只脚 ⇒ 行程减半，Nashner 策略转移条件） */
export const COP_LAT_LIMIT = COP_HALF_LEN * 0.6;

export interface BalanceHoldParams {
  /** 矢状面：VIP 比例增益（踝=CoP 策略主力） */
  kVipP: number;
  /** 矢状面：VIP 角速度微分增益 */
  kVipD: number;
  /** 矢状面：踝的被动刚度比例（× K_crit），<1 = 欠临界 */
  kAnkleStiff: number;
  /** 矢状面：髋的被动刚度比例（× K_crit,hip），>1 = 超临界 ⇒ 被动即稳 */
  kHipStiff: number;
  /** 踝 CoP 饱和后髋接管的份额 */
  kHipShare: number;
  /** ★ 矢状面**髋接管增益**（踝无 CoP 权限时必须用它；单腿站立场景） */
  kWtX: number;
  /** 矢状面：髋接管的 CoM 速度阻尼 */
  kWtVx: number;
  /** 额状面：VMP 比例增益（髋外展） */
  kVmpP: number;
  /** 额状面：VMP 角速度微分增益 */
  kVmpD: number;
  /** 额状面：**踝内/外翻**增益（与髋外展反向平衡，Liu 2012 的力学链末端） */
  kVmpAnkle: number;
}

export interface BalanceHoldInput {
  /** CoM 世界位置与速度 */
  comX: number; comY: number; comZ: number;
  comVx: number; comVy: number; comVz: number;
  /** 承重脚的世界 x / z（支撑脚中心） */
  stanceX: number; stanceZ: number;
  /** 踝（承重脚）世界高度 */
  ankleY: number;
  /** 全身质量（kg）—— 从 Rapier 各刚体实测求和，不手填 */
  bodyMass: number;
  /** 髋高（m），用于 K_crit,hip = m·g·h_hip */
  hipHeight: number;
  /** 是否处于单腿站立（此时髋接管矢状面） */
  singleLeg: boolean;
}

export interface BalanceHoldOutput {
  /** 踝矢状面角偏移（rad，正 = 背屈）—— 走 setAxis(foot, .., 轴 2) */
  ankleSag: number;
  /** 踝额状面角偏移（rad，正 = 外翻）—— 走 setAxis(foot, .., 轴 0) */
  ankleLat: number;
  /** 髋矢状面修正（rad，叠加到 IK 解算出的 h 上） */
  hipSag: number;
  /** 髋外展修正（rad，叠加到 IK 解算出的 h 上） */
  hipAbd: number;
  /** 躯干旋转指令（rad）—— 平衡相**恒为 0**（见文件头结论 ②） */
  spineCmd: number;

  // ── 诊断量（探针直接回读，全部有物理含义）
  qVip: number;        // VIP 摆角（rad）= CoP 前后位置
  qVipDot: number;
  qVmp: number;        // VMP 摆角（rad）= CoP 横向位置
  copOut: number;      // 矢状面 CoP 越界量（m）
  copLatOut: number;   // 额状面 CoP 越界量（m）
  kCritAnkle: number;  // K_crit = mgh（绕踝，N·m/rad）
  kCritHip: number;    // K_crit = mgh（绕髋，N·m/rad）
}

/**
 * 计算平衡维持指令。
 *
 * 纯函数：无内部状态 ⇒ 同输入必同输出 ⇒ 好回读、好单测、好定位"是哪条通道在漂"。
 */
export function balanceHold(p: BalanceHoldParams, i: BalanceHoldInput): BalanceHoldOutput {
  const G = 9.81;
  // 虚拟摆的"摆长"：踝到 CoM 的垂距（不能太小，否则 atan2 放大噪声）
  const vipY = Math.max(0.05, i.ankleY);

  // ── ① 矢状面 VIP（Morasso 2019/2022）────────────────────────────────
  const vipX = i.comX - i.stanceX;              // >0 ⇒ CoM 在踝前方
  const qVip = Math.atan2(vipX, vipY);           // VIP 摆角 = CoP 前后位置
  // 角速度：直接用 CoM 速度投影，避免除以小分母放大噪声
  const qVipDot = (i.comVx * vipY - vipX * i.comVy) / (vipY * vipY);

  // ③ 双刚度临界值（原文推导 τ_g = mgh·sin q ⇒ K_crit = mgh）
  const kCritAnkle = i.bodyMass * G * vipY;              // 绕踝的全身
  const kCritHip = i.bodyMass * G * (i.hipHeight * 0.55); // 绕髋的上身：h ≈ 踝的一半 ⇒ K_crit 也只有一半

  // ④ CoP 行程限制（Sci Rep 2025：metatarsal CoP range limitation）
  const copOut = Math.max(0, Math.abs(vipX) - COP_HALF_LEN * vipY);
  const copMargin = Math.max(0, 1 - copOut / 0.02);      // 出界 ⇒ 0（踝已饱和）

  // ②a 踝：欠临界被动刚度 + VIP 反馈 → 直接移 CoP（**主力**）
  //  ⚠ 量纲：K_crit 单位是 N·m/rad（刚度），角度通道要的是 rad。
  //    必须用**无量纲刚度比**，不能把 K_crit 直接当角度用（踩过一次：指令 −14638°）。
  const kAnkleActual = 0.7 * kCritAnkle;                  // 踝自身被动刚度（Winter 2001）
  const kAnkleReq = p.kAnkleStiff * kCritAnkle;           // 我们要求的（<K_crit，欠临界）
  const vipTau = -(p.kVipP * qVip + p.kVipD * qVipDot);   // 归一化反馈量
  const ankleSag = ((kAnkleReq / kAnkleActual) - 1) * -qVip - vipTau;
  // 出界后衰减：踝已饱和再加也没用 ⇒ 把活交给髋（Sci Rep 2025 的 "saturated ankle torque"）
  const ankleSagOut = Math.max(-0.26, Math.min(0.26, ankleSag * copMargin * 57.3 * Math.PI / 180));

  // ②b 髋：超临界被动刚度（>1 ⇒ 被动即稳），踝饱和时才主动增大
  const hipStiffRatio = p.kHipStiff - 1;
  const hipActive = -qVip * p.kHipShare * (1 - copMargin);

  // ── 单腿站立：髋接管矢状面（踝无 CoP 权限，见文件头结论 ①）──────────
  //   此前把 kWtX 全局归零，是把"迈步"场景的结论误用到"单腿站立"场景，
  //   结果矢状面完全没有控制器，躯干倾角 1.0°→8.8° 后倒下（存活仅 0.6s）。
  const hipSagSteer = i.singleLeg
    ? Math.max(-0.35, Math.min(0.35, -p.kWtX * vipX - p.kWtVx * i.comVx))
    : 0;

  // ── ② 额状面 VMP + 力学链（Liu et al., J Biomech 2012）───────────────
  //   "…a lateral bending (hip abduction/adduction) moment that is equilibrated
  //    at the ankle level by supination or pronation of the ankle"
  const vmpX = i.comZ - i.stanceZ;              // >0 ⇒ CoM 在支撑脚外侧
  const qVmp = Math.atan2(vmpX, vipY);
  const qVmpDot = i.comVz / vipY;
  const copLatOut = Math.max(0, Math.abs(vmpX) - COP_LAT_LIMIT * vipY);
  const latMargin = Math.max(0, 1 - copLatOut / 0.02);
  // 髋外展 + 踝内/外翻**反向**配对（符号已由实测标定：反向会发散到 −6.78 m）
  const hipAbd = Math.max(-0.30, Math.min(0.30, -(p.kVmpP * qVmp + p.kVmpD * qVmpDot) * latMargin));
  const ankleLat = Math.max(-0.24, Math.min(0.24, p.kVmpAnkle * qVmp * latMargin));

  return {
    ankleSag: ankleSagOut,
    ankleLat,
    hipSag: Math.max(-0.45, Math.min(0.45, hipStiffRatio * -0.08 + hipActive + hipSagSteer)),
    hipAbd,
    spineCmd: 0,     // ★ 平衡相恒 0（Riemann 2003：躯干是最不重要的纠正来源）
    qVip, qVipDot, qVmp, copOut, copLatOut, kCritAnkle, kCritHip,
  };
}

/** 把 CaptureParams 里的平衡字段抽成 BalanceHoldParams（省略值走默认值） */
export function holdParamsFrom(src: Record<string, unknown>): BalanceHoldParams {
  const g = (k: string, d: number): number => (typeof src[k] === 'number' ? src[k] as number : d);
  return {
    kVipP: g('kVipP', 26), kVipD: g('kVipD', 5),
    kAnkleStiff: g('kAnkleStiff', 0.5), kHipStiff: g('kHipStiff', 1.6), kHipShare: g('kHipShare', 0.25),
    kWtX: g('kWtX', 0.6), kWtVx: g('kWtVx', 0.6),
    kVmpP: g('kVmpP', 14), kVmpD: g('kVmpD', 3), kVmpAnkle: g('kVmpAnkle', 0),
  };
}