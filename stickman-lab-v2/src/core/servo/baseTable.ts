/** baseTable.ts —— 基础力矩表 + 目标角度表（v3 架构：状态相关、手动指定）
 *
 *  用户定调（2026-10-17）：
 *   · "基础力在正常站着、单腿站着都是不同的" —— 状态相关表
 *   · "需要手动介入设定目标力矩" —— 表驱动，不运行时算
 *   · "关节回正也要有目标的角度" —— 目标角度表
 *   · "重力补偿说不定在一些中间态或者预测层预测应急的时候可能要用；
 *      一些重要基础的标准姿势可能不需要重力补偿了"
 *     ⇒ 标准姿势查表；中间态/预测应急保留 gcomp
 *
 *  表的来源：gcomp 标定工具测量 + 旧版验证值（150/40/30——703c8bcb 站稳档）
 */

export interface BasePose {
  /** ★ 状态参数集（用户架构：所有参数状态隔离）——回正力 kp/lim 补丁 + CoM */
  params?: {
    comX?: number;           // CoM 目标 x（缺省 0）
    footFloor?: number;      // 踝 tau 地板（站立 15 / 蹲姿 80）
    kneeTwFloor?: number;    // 膝扭转 tau 地板（蹲姿 180）
    hipKpMul?: number;       // 髋 kp 倍率（默认 1）
    limitBase?: number;      // ★ 限位冲量基准（N·m；不跟 τmax——每状态独立，默认 212）
    /** ★ 回正力（站立式架构，蹲姿单独调参）：**带宽 ω**——每关节 kp=I×ω²、kd=2I×ω（惯量标定） */
    corrW?: number;
    // ★★★ 2026-10-20 用户（'静止和蹲姿的各个参数应该完全分隔开'）：蹲姿基础力/回正参数进状态表
    baseScale?: number;      // 基础力总倍率（蹲姿标定）
    spineScale?: number;     // 脊柱段基础力倍率
    spineSign?: number;      // 脊柱段基础力符号（+1 伸展 / -1 前压）
    kneeScale?: number;      // 膝段基础力倍率
    corrKp?: number;         // 回正力 Kp（0=按 Iω² 惯性标定）
    // ★ CoM 反馈（唯一回路，Jᵀ 映射；y=竖直 z=侧向）
    comKpY?: number; comKdY?: number; comKpZ?: number; comKdZ?: number;
  };
  /** 基础力矩（N·m，每轴 `${关节}${轴}`） */
  tq: Record<string, number>;
  /** 目标角度（rad，每轴；缺省=初态捕获） */
  ang?: Record<string, number>;
  /**
   * ★★★ 2026-10-18 用户（'关节限位也要放进状态伺服分区/架构干净'）：**状态化关节伺服参数**——
   *   τmax 覆盖 + 屈伸轴限位（度），按 [正则, ...] 顺序匹配。切状态时统一应用（world.switchPoseState）。
   */
  joints?: {
    /** τmax 覆盖：[名字正则, τmax] */
    tauMax?: Array<[string, number]>;
    /** 屈伸限位（度）：[名字正则, 轴, minDeg, maxDeg] */
    limits?: Array<[string, number, number, number]>;
    /** ★ 速度限位（rad/s）：[名字正则, 轴(-1=全轴), velMax]——驱动层刹车（超限即减速度） */
    velMax?: Array<[string, number, number]>;
  };
}

export const BASE_TABLE: Record<string, BasePose> = {
  stand: {
    params: { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1 },
    // ★ 静止站立一套关节伺服参数（用户：'静止站立一套，蹲下一套'）
    joints: {
      velMax: [
        ['^(shoulder|elbow)', -1, 8],   // 手臂：站立 8 rad/s
        ['^(hip|knee|foot|ankle)_', -1, 10],
        ['^spine', -1, 6],
        ['^neck', -1, 8],
      ],
    },
    tq: {
      // ★ 2026-10-17 双腿站立标定（旧版150是单腿值；双腿扫描最佳：20/30/40）
      // ★ 2026-10-17 基础力矩表（实测静态重力矩；**右腿原始值**——左腿由镜像自动取反）
      sup_hip0: 0.9, sup_hip1: 0, sup_hip2: 0,
      sup_knee0: -1.3, sup_knee1: 0, sup_knee2: 0,
      sup_foot0: 0, sup_foot1: 0, sup_foot2: 0,
      swing_hip0: 0, swing_hip1: 0, swing_hip2: 80,
      swing_knee0: 0, swing_knee1: 0, swing_knee2: -55,
      swing_foot0: 0, swing_foot1: 0, swing_foot2: 0,
    },
    ang: {
      // S 形脊柱（矢状=轴2；轴2 正=后仰、负=前倾）—— 标准姿态目标角
      spine1_2: -0.07, spine2_2: 0.10, spine3_2: -0.082,
      neck_2: 0.04,
      // 脊柱基础力矩（实测静态重力矩）
    },
  },
  // ★ 2026-10-17 深蹲状态（用户设计：蹲下的状态=三层架构）
  //   蹲姿态角与蹲底静态力矩：探针实测（2026-10-17：[hip=1.0,knee=-1.0,foot=-0.3] → 头79cm）
  //   论文依据：三关节峰值在蹲底；躯干前倾30-40°保 CoM
  squat: {
    params: { comX: 0, footFloor: 80, kneeTwFloor: 180, hipKpMul: 1, corrW: 3,   // ★ 蹲姿回正带宽（单独调；kd=2Iω 自动）
      // ★★★ 蹲姿基础力/回正参数（与站立完全分开；env SQB_*/SQ_CORR_KP 仅作调试覆盖）
      baseScale: 1.01, spineScale: 0.55, spineSign: 1, kneeScale: 0.15, corrKp: 0,
      comKpY: 9, comKdY: 4, comKpZ: 9, comKdZ: 4 },
    tq: {
      // ★★★ 2026-10-18 用户（'快实装吧'）：**静态实测标定**（70kg 模型——弹簧撑住姿势读平衡力矩）：
      //   髋 = +280（唯一大头——用户'髋是核心'）、膝/踝 ≈ 0（测量值 -5/-0）
      // ★ 2026-10-18 实测：髋 -65（+阻尼刹车）撑骨盆；膝 +50 撑对折；腰 +200 撑躯干（上身55→56cm稳）
      // ★ 2026-10-18 用户（'髋部的力矩大多要直接从踝传'）：髋局部表值归零——
      //   髋的力由 GRF 项（地面反力×力臂=从踝传）承担；局部硬顶=大腿撑直=站起来
      // ★ 2026-10-18 用户（'膝盖只传力，不出力，出力就是让腿直起来'）：膝局部归零——只走 GRF 传力
      // ★★★ 2026-10-18 用户（'只满足标准姿势的需求！！！'）：表值 = 需求 − gcomp
      //   髋: -24-24=-48  膝: +3-5=-2  踝: 0  （gcomp 的腿自重会抵消表值——实测髋 表-25+gc24=净-1）
      // ★ 2026-10-18 用户（'看脚有什么受力'）：踝 +50 撤销——FF 回读证实它是脚上 +62 的提案（把脚翘起）
      sup_hip2: -72, sup_knee2: -3, sup_foot2: 0,   // ★ 用户（'继续增强力链'）：×1.5
      // ★ 2026-10-18 用户（'力有点太大/脊柱也要略微挺一下'）：腰收一档 + 腰2/3 略挺
      // ★ 2026-10-18 用户（'脊柱弹性很强，减少腰和大腿的夹角而不是让脊柱更弯'）：脊柱表值归零——治本在髋
      // ★★★ 2026-10-18 用户（'为什么上身没有力'）：CH 回读脊柱需求（spine1=-116/2=-58/3=-13）
      //   实际只有 gcomp ±3（且翻转符号反了）→ 缺口 118/61/15；表值=需求−实际
      sup_spine12: -176, sup_spine22: -92, sup_spine32: -23, sup_neck2: 0,   // ★ ×1.5
      // ★ 2026-10-18 用户（'手臂不需要乱写的'）：手臂表值全零——恒定表值=自旋驱动（+34 vs 阻尼-3v=稳态11rad/s）
      //   手臂=仅 gcomp（重力补偿）+ 阻尼（残余自旋衰减）
      sup_hip0: 0.9, sup_knee0: -1.3, sup_foot0: 0,
      swing_hip2: 80, swing_knee2: -55, swing_foot2: 0,
    },
    ang: {
      // 蹲姿态目标角（回正力的目标；按全名分侧）
      // ★ 2026-10-18 目标姿势（K=2.1+膝前22cm）rotvec实测读数（rad）
      hip0: 0, hip1: 0, hip2: 2.09,
      knee0: 0, knee1: -0.30, knee2: -2.08,
      foot0: 0, foot1: 0, foot2: 0,   // ★ 踝背屈（=法庭摆姿的 ankA！目标0会把踝往回猛拉=脚飞）
      // 躯干前倾（论文：蹲时躯干前倾30-40°配 CoM）
      spine1_2: -0.42, spine2_2: -0.42, spine3_2: -0.42,   // ★ 与法庭摆姿一致（-0.42×3=腰43°）——否则回正力把腰拉回-0.25→后弹
      neck_2: 0.04,
      // ★ 手臂前伸配重（用户：'手臂也要放到前面配重'——与法庭 SQC_ARM 一致）
      shoulder2: 0.5,    // ★ 与法庭一致（手在肩下）
    },
    // ★★★ 状态化关节伺服参数（用户：'为蹲下状态专门弄一套关节伺服参数'）
    joints: {
      tauMax: [
        ['^hip_', 800],
        ['^knee_', 450],
        ['^(foot|ankle)_', 320],   // ★ 用户（'踝的力不到位撑不起身体'）：踝预算 170→320（地面路径的主力）
        ['^spine', 320],
        ['^neck', 150],
        ['^(shoulder|elbow)', 160],
      ],
      limits: [
        ['^spine', 2, -60, 60],      // 腰：折到 −43 逼近 ±45 → 限位冲量爆 +370 → 放宽到 ±60
        ['^hip_', 2, -120, 175],     // 髋：蹲姿 130-136° 超骨架上限 100° → 放宽；摆动到 163 又超 160 → 175
        ['^knee_', 2, -165, 5],      // 膝：深折 −130 余量
        ['^(foot|ankle)_', 2, -45, 45],   // ★ 踝：+50压脚顶死+30引擎限位→挣脱时踝速105脚飞→放宽
      ],
      // ★★★ 2026-10-18 用户（'加强基础力'）：速度限位刹车=混沌源（下坠 v=10-20 时刹车爆 ±480-800，
      //   髋实测 +617 vs 表值 -144）——蹲姿放开（999=无效）；站立保持原值
      velMax: [
        ['^(shoulder|elbow)', -1, 999],
        ['^(hip|knee|foot|ankle)_', -1, 999],
        ['^spine', -1, 999],
        ['^neck', -1, 999],
      ],
    },
  },
  // ★ 2026-10-17 用户（'单腿也是一个伺服状态'）：占位状态——名字就位，参数待标定
  //   单腿（右腿支撑）——张力/回正/基础力都将是独立的一套
  singleR: {
    params: { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1 },   // 待标定
    tq: {},    // 待标定（右支撑腿/左摆动腿各自的静态力矩表）
    ang: {},   // 待标定（单腿目标姿态）
  },
  // stepR / stepL —— 迈步状态占位（待用）
  stepR: { params: { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1 }, tq: {}, ang: {} },
  stepL: { params: { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1 }, tq: {}, ang: {} },
};

let _state = 'stand';

/** 切换状态（状态机接管；当前默认 stand） */
export function setBaseState(s: string): void { _state = s; }
export function baseState(): string { return _state; }

/** ★ 当前状态的关节伺服参数（τmax+限位；缺省 undefined=用骨架默认） */
export function baseJoints(): BasePose['joints'] {
  const T = BASE_TABLE[_state] ?? BASE_TABLE.stand!;
  return T.joints;
}

/** 查表：基础力矩（N·m；缺省 0） */
export function baseTq(jn: string, ax: number, sup = true): number {
  const T = BASE_TABLE[_state] ?? BASE_TABLE.stand!;
  const pre = sup ? 'sup_' : 'swing_';
  return T.tq[`${pre}${jn}${ax}`] ?? T.tq[`${jn}${ax}`] ?? 0;
}

/** ★ 查表：状态参数（comX/kp 地板——状态隔离） */
export function baseParams(): { comX: number; footFloor: number; kneeTwFloor: number; hipKpMul: number; limitBase: number; corrW?: number; baseScale?: number; spineScale?: number; spineSign?: number; kneeScale?: number; corrKp?: number; comKpY?: number; comKdY?: number; comKpZ?: number; comKdZ?: number } {
  const T = BASE_TABLE[_state] ?? BASE_TABLE.stand!;
  return { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1, limitBase: 212, ...(T.params ?? {}) };
}

/** ★★★ 2026-10-18 目标自动统一（用户：'一个伺服状态不应该目标姿势只有一个实现'）：
 *  把当前**实际读数**捕获为状态目标角——法庭摆完姿势后调用，
 *  从此"摆出来的姿势"就是"回正力目标"，单一事实来源，永不打架。 */
export function captureAngFrom(dofs: Array<{ name: string; axis: number; angle: number }>): void {
  const T = BASE_TABLE[_state] ?? BASE_TABLE.stand!;
  if (!T.ang) T.ang = {};
  for (const d of dofs) {
    T.ang[`${d.name}${d.axis}`] = d.angle;
  }
}

/** 查表：目标角度（rad；undefined=用初态捕获） */
export function baseAng(jn: string, ax: number): number | undefined {
  const T = BASE_TABLE[_state] ?? BASE_TABLE.stand!;
  const a = T.ang;
  if (!a) return undefined;
  // ★ 2026-10-17 兼容两种键：调用方有的传全名（knee_r）、有的传基名（knee）
  return a[`${jn}${ax}`] ?? a[`${jn.replace(/_[lr]$/, '')}${ax}`] ?? a[`${jn}_${ax}`];   // 三种键：knee_r2 / knee2 / spine1_2
}
