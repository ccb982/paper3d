// ============================================================
// skeleton —— 火柴人骨架定义（★ 真 3D：球关节 + 三轴软限位）
// ============================================================
// ★★ 为什么必须是 3D（用户定调，别退回平面方案）
//   2D 版本把"前进"和"侧向"塞进了同一个轴：所有刚体锁死 enabledTranslations(T,T,F)
//   + enabledRotations(F,F,T)，只能绕 Z 转。而绕 Z 转 = 肢体在画布平面内左右摆 ——
//   那是**外展**，不是**屈伸**。也就是说 2D 版本根本表达不了"迈腿"这个动作：
//   腿的屈伸平面（矢状面）跟它的旋转轴（侧向轴）在 2D 里是同一个平面，
//   于是"走路"只能靠整体前倾+滑行。跑一个 2D 机器人对本体的 3D 游戏没有任何意义。
//
//   3D 之后：髋/膝的屈伸 = 绕**侧向轴**转，肢体在**矢状面**内摆动 —— 这才是迈腿。
//   每个关节是球关节（3 转动自由度），力矩可以同时施加在三个轴上。
//
// ★★ 世界轴约定
//     +X = 前（行走方向；适应度的"前进距离"就是 torso.x − startX）
//     +Y = 上
//     +Z = 角色侧向
//
//   素材是**正面视图**，只有横向（画布 x）和竖向（画布 y）信息，没有深度。
//   映射：画布 y → 世界 Y（上）；画布 x → 世界 **Z**（侧向，手臂因此天然垂在身体两侧）；
//         世界 X（前）全部置 0 —— 素材给不出深度，宁可诚实归零。
//
//   ★ 侧向取负：z = −(canvasX − centerPx)·px2m。原因是"从正面看"时屏幕右方向 = 世界 −Z
//     （相机在 +X 看向 −X，up=+Y ⇒ 视线右 = cross(forward, up) = −Z）。
//     不取负的话，人形会左右镜像（画布左边的组件跑到屏幕右边）。贴片朝向见 viewer.ts。
//
// 几何：全部来自 parts.json —— 每个组件的 alpha 包围盒给出它的尺寸与位置，
//       相邻组件包围盒的【重叠区】就是关节所在处。贴图因此能严丝合缝长在刚体上，
//       不需要手调任何数字。
//
// 质量：Dempster 1955《Space Requirements of the Seated Operator》人体环节参数
//       （Winter《Biomechanics and Motor Control of Human Movement》Table 4.1 收录，
//        也是绝大多数人体仿真的默认值；单位 = 占总体重百分比）
//
//         环节        质量%   质心位置/环节长(从近端)   回转半径/环节长
//         头颈         8.10        0.495                   0.495
//         躯干        49.70        0.495                   0.406
//         上臂         2.80        0.436                   0.322
//         前臂+手      2.20        0.682                   0.468
//         大腿        10.00        0.433                   0.323
//         小腿         4.65        0.433                   0.302
//         足           1.45        0.500                   0.475
//
//       本骨架把「小腿 + 脚」做成**同一刚体上的两个 collider**（用户定调：脚和小腿一体化）：
//         collider A = 小腿胶囊（4.65%，质心 0.433，回转 0.302）
//         collider B = 脚掌扁盒（1.45%，挂在胶囊底端，绕踝）
//       两 collider 质量相加 = 6.10%。★ 质量必须逐个 collider 给 —— 不给的话
//       Rapier 会按默认密度 1.0 给脚掌凭空加质量，体重就直接错了。
//       Rapier 会自动按平行轴定理把两个 collider 合成刚体的总质量/质心/惯量。
//
//       质量比之和 = 49.70+8.10+2×2.80+2×2.20+2×10.00+2×6.10 = 100.00% ✔
//
// 关节限位：主自由度（屈伸，绕 Z）取自 MuJoCo humanoid.xml
//           （膝 range="-160 2" 只许后弯不反折；肩 -85~60；肘 -100~50）。
//           另外两轴（绕 X 外展 / 绕 Y 扭转）见 JOINT_LIMITS_XY_DEG。
//           本骨架无踝关节（脚与小腿一体化），关节数 = 9，总转动自由度 = 27。

import { META, LIMB_AXES, PART_BY_KEY, type JointMeta, type PartMeta } from './partsMeta';

// ---------------------------------------------------------------- 配置

/** 三轴量（X / Y / Z），语义见文件头的轴约定 */
export type Vec3 = readonly [number, number, number];
/** 四元数 (x, y, z, w) */
export type Vec4 = readonly [number, number, number, number];

/**
 * ★ 刚体**静姿态**四元数：`Ry(yaw) ⊗ Rx(tilt)`。
 *
 * 静姿态 = 素材画的那张姿势在骨骼层面的表示（肢体沿实测中轴躺平 + 膝盖以下向内偏航）。
 * 它**不是**动力学状态：物理体创建/复位时带上它，之后只由马达相对它转动。
 * 渲染端用它的逆把贴图补偿回素材原位（viewer.ts 的 qRel），所以"纹理别动"成立。
 */
export function restQuatOf(tiltRad: number, yawRad: number): Vec4 {
  const ht = tiltRad / 2, hy = yawRad / 2;
  // Ry(hy) ⊗ Rx(ht) 的精确乘积（★ z 分量是 −sin(hy)·sin(ht)：
  //   写成 −cos(hy)·sin(ht) 会让 yaw=0 时四元数**同时含 x 和 z 分量**，
  //   倾角就绕进了 Z 轴 ⇒ 侧视图里骨骼是斜的。这个 bug 踩过一次，别改回去。）
  return [
    Math.cos(hy) * Math.sin(ht),
    Math.sin(hy) * Math.cos(ht),
    -Math.sin(hy) * Math.sin(ht),
    Math.cos(hy) * Math.cos(ht),
  ];
}

/**
 * ★★ **视觉补偿**用的静姿态 = 只有倾角，**不含偏航**。
 *
 * 这条区分是用户两次回读逼出来的，必须写死：
 *   · `restTiltRad`（实测中轴倾角）= **素材就是这么画的** ⇒ 贴图必须补偿回原位，
 *     否则等于"旋转纹理来假装骨架对了"（用户："纹理别动，调整关节的倾斜度"）。
 *   · `restYawRad`（膝盖以下内收）= **我们主动纠正的站姿**，素材画的是外八字、
 *     用户要求改成内收（"脚部骨骼向内收一下"）⇒ 这是真正的骨骼旋转，
 *     **贴图必须跟着转**，否则脚掌 collider 已经内收、肉眼看到的靴子还是外八。
 */
export function restVisualQuatOf(tiltRad: number): Vec4 {
  return restQuatOf(tiltRad, 0);
}

/** 单位四元数的逆（共轭） */
export function invQuatOf(q: Vec4): Vec4 {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** 四元数 → 旋转矢量（|v| = 角度，方向 = 轴）；与 ragdoll 的 quatToRotVec 同口径 */
export function quatToRotVec(q: Vec4): Vec3 {
  const w = q[3] > 1 ? 1 : q[3] < -1 ? -1 : q[3];
  const half = Math.acos(w);
  const s = Math.sin(half);
  if (Math.abs(s) < 1e-7) return [0, 0, 0];
  const ang = 2 * half;
  const k = ang > Math.PI ? -(2 * Math.PI - ang) / s : ang / s;
  return [q[0] * k, q[1] * k, q[2] * k];
}

/** conj(a) ⊗ b */
function quatRel(a: Vec4, b: Vec4): Vec4 {
  const cx = -a[0], cy = -a[1], cz = -a[2], cw = a[3];
  return [
    cw * b[0] + cx * b[3] + cy * b[2] - cz * b[1],
    cw * b[1] - cx * b[2] + cy * b[3] + cz * b[0],
    cw * b[2] + cx * b[1] - cy * b[0] + cz * b[3],
    cw * b[3] - cx * b[0] - cy * b[1] - cz * b[2],
  ];
}

/** 用四元数旋转向量（x,y,z） */
export function rotVecByQuat(q: Vec4, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

export interface SkeletonConfig {
  /** 角色总高（米）。素材 span 高（2807px）映射到该值 */
  height: number;
  /** 总体重（kg），按 Dempster 比例分配到各环节 */
  mass: number;
  /** 站姿宽度缩放：1 = 素材原样，0 = 双腿并拢到中线 */
  stance: number;
  /** 胶囊半径 = 包围盒半宽 × 该系数（<1 = 物理比美术瘦，避免刚体互穿抖动） */
  limbRadiusScale: number;
  /**
   * ★★ 躯干沿脊柱切成几段（≥1）。用户定调：「身体部分也是需要和脊椎一样有很多关节的」。
   *
   * 为什么不能把躯干做成一个刚体：
   *   · 真实人体的躯干有 24 节椎骨（有意义的运动节段约 17 个），腰-胸-颈是三个曲度。
   *     一整块刚体意味着"弯腰/转体/侧倾"三个自由度全丢了 —— 只剩一个整体旋转。
   *   · 对走路的影响是直接的：躯干必须能**反向扭转**来抵消腿的角动量
   *     （人走路时骨盆与胸腔反向旋转 ±5~8°，这是"不甩胳膊就站不稳"的物理原因）。
   *   · 对战斗的影响更直接：出拳的力从地面→腿→骨盆→脊柱→肩→手，
   *     一条刚体躯干等于把力量链掐成两截。
   *
   * 制造成本：段数 K ⇒ K−1 个脊柱关节（每个 +3 转动自由度、+3 网络输出、+6 网络输入），
   *           刚体数 +K−1。段 0 = 骨盆（key 仍是 'torso'，所以 torso() 语义不变），
   *           躯干上原有的 9 个关节按解剖重新挂：髋 → 骨盆，颈/肩 → 最上一段（胸腔）。
   *
   * ★ 视觉：躯干护甲仍是**一整张贴图 + 单个 mesh**，按脊柱段做逐顶点线性混合蒙皮
   *   —— 弯腰时板子沿脊柱连续弯折，不是把贴图切成 K 条各贴一段。见 viewer.ts。
   */
  spineSegments: number;
  /** ★ 腿段拉伸（m）：把膝/踝锚点相对髋下沉，等比拉长腿。
   *   动机：素材髋高 0.849 m > 腿长 0.785 m（leg/hip=0.92，低于人体 0.95~1.0）
   *   ⇒ 站直时膝折 30°，实测躯干持续前倾 35.8°、CoM 前移 0.46 m。 */
  legStretch: number;
  /**
   * ★★ 脚掌**足迹**缩放（默认 1.0）。只缩放水平面（长 hx / 宽 hz），不动厚度。
   *
   * 为什么需要一个专门的旋钮（用户提问引出的一次量化）：
   *   脚掌是**站立能力的唯一硬约束** —— 支撑域半宽 p_max 直接决定"能刹住多快的重心"
   *   `v_catch = ω·p_max`（ω = √(g/z_c)）。而本骨架的两个数都偏小：
   *     · `META.sole.len`（= 343 px = 0.220 m）是**手填常数**，不是从素材推的；
   *       脚长/身高 = 0.122，而真人 ≈ 0.15 ⇒ 前后平衡极限只有解剖值的 ~80%。
   *     · 侧向半宽 = `小腿胶囊半径 × 0.9`，而半径又被 `limbRadiusScale = 0.6` 削过
   *       ⇒ 物理脚宽 0.129 m，**远窄于画里的脚**（shin 贴图 bbox 宽 0.239 m）。
   *   ⇒ 于是"脚比画里小"这件事必须能被量化、能被扫，而不是埋在素材里没人知道。
   *   ★ 注意：**调大它不会让人偶变高或变胖**，只让脚下的支撑域变大。
   *   ★ 代价：脚变长会让"迈步"更容易踢到自己的另一只脚（本骨架关掉了自碰撞，所以只是视觉问题）。
   */
  soleFootScale: number;
  /**
   * ★★ 脚掌外八角（度，默认 25 = **外八**：脚尖朝身体外侧）。
   *
   * 用户定调（2026-10-01）："脚要向外侧倾斜，做成外八"。
   * 只作用于两根小腿的**静姿态**：绕竖直轴偏航，把脚尖从"正前方"转向外侧。
   * 方向：`mapZ` 取负 ⇒ 画布 x 小的**左脚在世界 +Z**；绕 +Y 转 ψ 把 +X 转向 −Z，
   * 所以外八必须**左脚 −ψ、右脚 +ψ**（反了就是内八 —— 这个符号错过一次）。
   * 负值 = 内八，0 = 正前方。
   *
   * ★ 这不是"旋转纹理作弊"：偏航是**主动的站姿选择**，贴图必须跟着转；
   *   被"补偿回素材原位"的只有实测中轴倾角（`restVisualQuatOf`）。
   */
  footSplayDeg: number;
  /**
   * ★★ 踝关节（用户 2026-10-01："脚做踝关节，纹理上用脚部位的uv扭曲"）。
   *   之前脚掌只是**小腿刚体上的第二个 collider**（同一个刚体 ⇒ 脚不能主动转），
   *   "落脚/蹬地/勾脚"全都做不到 —— 这是 6 s 必倒的结构性原因。
   *   现在把脚掌拆成**独立刚体 + 踝 revolute**；视觉上脚部仍在小腿贴图里，
   *   靠 `footUvWarpDeg` 的 UV 扭曲跟着踝角走（渲染层做，物理不参与）。
   */
  /** [低头(plantarflex, 蹬地/尖脚), 勾脚(dorsiflex, 脚跟先着地)]，单位度 */
  anklePitchDeg: readonly [number, number];
  /** 内外翻余量（外八已经在静姿态偏航里） */
  ankleRollDeg: number;
  ankleTorque: number;
  /** ★ 踝（跖屈肌）力矩上限 N·m —— **A 方案的核心参数**。
   *   文献：人类跖屈肌 MVC ~120~140 N·m；Neptune/Perry, Front Neurol 2019, 10:999
   *   —— 跖屈肌是 CoM 推进的**主引擎**，效率是髋肌的 4 倍。
   *   为什么必须能调：把 CoP 从脚底中心推到脚尖需 ≈ 体重×足半长 ≈ 30×9.81×0.10 ≈ 29 N·m，
   *   推到边缘 ≈ 35 N·m。默认 45 名义够，但实测踝指令对动力学**零效力**（kCop 放大 33 倍、
   *   本值放大 9 倍，CoM/倾角/存活全部逐位不变）⇒ 不是幅度问题，是踝没接入动力学。 */
  /** 脚部 UV 扭曲的最大额外角度（度）：0 = 只跟物理踝角，>0 = 视觉夸张 */
  footUvWarpDeg: number;
  /**
   * ★★ 踝关节总开关，**默认 false**。
   *   代码路径已全部就绪（独立脚掌刚体 + 踝 revolute + 门禁都按 10 关节更新，verify 全绿），
   *   但**打开后走不了**：脚一旦变成独立刚体，腿部动力学就变了
   *   （实测 0.5 s 内骨架塌 41 cm、实际关节运动幅度涨 1.5 倍、位移 1.25 m → 0.08 m，
   *   把踝**锁死**也一样坏 ⇒ 不是自由度的问题，是刚体拆分后 PD 增益/惯量分布要重调）。
   *   所以先默认关着（= 脚掌回到"小腿上的第二个 collider"，即加踝前的物理），
   *   等重调 kP/kD 或把踝做成刚性锁，再打开。
   */
  ankleEnabled: boolean;
}

export const DEFAULT_CONFIG: SkeletonConfig = {
  height: 1.8,
  mass: 70,
  // ★ 2D 时代用 0.5 是为了在**同一个平面内**减少双腿互穿；3D 之后双腿分开在 Z 上，
  //   再并拢反而让两个大腿胶囊（半径 6.9cm、间距 10cm）重叠。取 1.0 = 素材原样的
  //   自然站姿宽度（大腿中心间距 ≈ 0.20m）。
  stance: 1.0,
  limbRadiusScale: 0.6,
  // 4 段 ⇒ 骨盆 + 3 节脊椎（腰-胸-颈），脊柱关节 3 个，转动自由度 36。
  // 段数不宜再多：每段都要有独立质量与惯量，切太细 ES 的搜索空间会爆炸（且小段的
  // 惯量趋近于 0，正是 probe-motor 里那种"数值爆炸"的温床）。
  spineSegments: 4,
  legStretch: 0.02,
  /**
   * ★ 踝（跖屈肌）力矩上限 N·m。**A 方案的核心参数。**
   *   文献依据：人类跖屈肌 MVC ~120~140 N·m；
   *   Neptune/Perry, Front Neurol 2019, 10:999 —— 跖屈肌是 CoM 推进的**主引擎**，
   *   "the work produced by these muscles has been **four times more efficient** than
   *    the work produced by the hip muscles to sustain the CoM increment during
   *    the single-stance period"。
   *   为什么必须抬：把 CoP 从脚底中心推到脚尖需要 ≈ 体重 × 足半长 ≈ 30×9.81×0.10 ≈ 29 N·m，
   *   推到边缘 ≈ 35 N·m。原来的 45 N·m 名义上够，但实测只用到声明值的 18~28%
   *   ⇒ 踝力矩对动力学**零效力**，CoP 移不动 ⇒ 承重转移无法发生。
   *   留空/默认 = JOINT_MAX_TORQUE 的 45（探针按此档扫描）。
   */
  //   legStretch=0.02 由 probe-arch 扫描定值：终 CoM +0.048（其余档 −0.25~−0.66）、离地峰 103mm
  soleFootScale: 1.0,
  // ★★ 脚掌外八 25°（用户定调："脚要向外侧倾斜，做成外八"，随后"再向外一点"）。
  //   脚掌盒的**横向位置**仍按膝锚点摆（膝到脚尖铅垂），外八只改脚尖的朝向。
  footSplayDeg: 25,
  // 踝：低头 25°（蹬地/尖脚）… 勾脚 20°（脚跟先着地）。保守取值，避免刚体互穿。
  anklePitchDeg: [0, 0],
  ankleRollDeg: 0,
  ankleTorque: 45,
  footUvWarpDeg: 0,
  ankleEnabled: false,
};

// ---------------------------------------------------------------- 环节规格

type Proximal = 'top' | 'bottom';

interface SegmentSpec {
  key: string;
  bone: string;
  label: string;
  /** 占总体重百分比（Dempster） */
  massPct: number;
  /** 质心位置 / 环节长，从近端算（仅作用于主 collider） */
  comRatio: number;
  /** 回转半径 / 环节长（仅作用于主 collider） */
  gyrationRatio: number;
  proximal: Proximal;
  /** 腿环节：受 stance 收窄影响 */
  leg?: boolean;
  /** ★ 主 collider 之外再挂一个脚掌 collider（占总体重 %，Dempster「足」= 1.45） */
  soleMassPct?: number;
}

/**
 * 本骨架的 10 个环节。key 刻意与 parts.json 的组件 key 完全一致 —— 一环节一张贴图，1:1。
 * 顺序即刚体创建顺序。
 */
export const SEGMENTS: readonly SegmentSpec[] = [
  { key: 'head',    bone: 'head',   label: '头',     massPct: 8.10,  comRatio: 0.495, gyrationRatio: 0.495, proximal: 'bottom' },
  { key: 'torso',   bone: 'torso',  label: '躯干',   massPct: 49.70, comRatio: 0.495, gyrationRatio: 0.406, proximal: 'bottom' },
  { key: 'arm_l',   bone: 'armL',   label: '左上臂', massPct: 2.80,  comRatio: 0.436, gyrationRatio: 0.322, proximal: 'top' },
  { key: 'arm_r',   bone: 'armR',   label: '右上臂', massPct: 2.80,  comRatio: 0.436, gyrationRatio: 0.322, proximal: 'top' },
  { key: 'hand_l',  bone: 'handL',  label: '左前臂', massPct: 2.20,  comRatio: 0.682, gyrationRatio: 0.468, proximal: 'top' },
  { key: 'hand_r',  bone: 'handR',  label: '右前臂', massPct: 2.20,  comRatio: 0.682, gyrationRatio: 0.468, proximal: 'top' },
  { key: 'thigh_l', bone: 'thighL', label: '左大腿', massPct: 10.00, comRatio: 0.433, gyrationRatio: 0.323, proximal: 'top', leg: true },
  { key: 'thigh_r', bone: 'thighR', label: '右大腿', massPct: 10.00, comRatio: 0.433, gyrationRatio: 0.323, proximal: 'top', leg: true },
  { key: 'shin_l',  bone: 'shinL',  label: '左小腿', massPct: 6.10,  comRatio: 0.433, gyrationRatio: 0.302, proximal: 'top', leg: true, soleMassPct: 1.45 },
  { key: 'shin_r',  bone: 'shinR',  label: '右小腿', massPct: 6.10,  comRatio: 0.433, gyrationRatio: 0.302, proximal: 'top', leg: true, soleMassPct: 1.45 },
];

/** 关节顺序 = 马达索引 = 网络输出顺序（改这里必须同步 brain.ts 的输出维度） */
export const JOINT_ORDER: readonly string[] = [
  'neck',
  'shoulder_l', 'shoulder_r',
  'elbow_l', 'elbow_r',
  'hip_l', 'hip_r',
  'knee_l', 'knee_r',
  // ★ 踝（2026-10-01 新增）：脚掌是独立刚体，这两项是它的俯仰/内外翻。
  //   放在最后 ⇒ 已有的 0~7 号马达索引不变（旧基因组的权重仍对得上前 8 个关节）。
  'foot_l', 'foot_r',
];

/**
 * ★★ 脊柱（**腰**）关节的真实名字。
 *
 * 背景（2026-10-02，用户："再去修腰的问题"）：腰的关节**确实存在**
 * （`spineSegments = 4` 时会 `joints.push({name: 'spine1'}, 'spine2', 'spine3')`），
 * 但它们是在构造时**动态追加**的，名字也不在上面这个 `JOINT_ORDER` 里
 * ⇒ `JOINT_ORDER.indexOf('spine1')` 永远返回 −1 ⇒ `setAxis` 静默 return
 * ⇒ **腰这个角色从接入到现在一次指令都没收到过**。
 *
 * ⇒ 用**关节实例**（`sk.joints[i].name`）查，而不是用这个常量。
 */
export function jointIndexByName(sk: Skeleton, name: string): number {
  for (let i = 0; i < sk.joints.length; i++) if (sk.joints[i]!.name === name) return i;
  return JOINT_ORDER.indexOf(name);
}

/** 该骨架里实际存在的脊柱关节名（spine1..spineK-1）；没有分段时返回空 */
export function spineJointNames(sk: Skeleton): string[] {
  const out: string[] = [];
  for (const j of sk.joints) if (/^spine\d+$/.test(j.name)) out.push(j.name);
  return out.sort();
}

/**
 * ★★ 关节锚点 = `limbAxes.json` 的实测值（`tools/measure-limb-axes.py` 从 alpha 掩膜测）。
 *
 * 演进过程（三次返工，每次都有实测依据）：
 *   ① `build-parts.py::joint_anchor()` = 父/子 bbox **重叠区中心**。
 *      对细交叉的铰链（颈 219px / 肘 178px / 膝 143px）成立；
 *      对深重叠的球窝关节错得离谱：肩的重叠区 = **整条上臂**（595px）⇒ 中心落在上臂中点，
 *      肩锚点只有 1.267 m（肩峰解剖值 1.46 m）⇒ 显矮 + 上臂贴图上部 0.14 m 无锚点（"悬空"）。
 *   ② 临时改成"取子部件 bbox 上缘" ⇒ 肩/髋高度回到解剖分数，
 *      但**右肩 78.7% 出界**：源图左右本就不等高（左臂顶 y=625 / 右臂顶 y=693，差 68px）。
 *   ③ 现在：逐行取 alpha 覆盖中点、按行宽加权最小二乘拟合**中轴**，
 *      锚点按优先级取"父子 alpha 都覆盖且余量够"的点 ——
 *      肘/膝取两中轴求交（真实铰链位置），肩/髋取父子 alpha 重叠区的**首次接触点**
 *      （解剖上肩/髋就是上/下肢与躯干最初相接处），并对肩/髋要求 **25px 内缩**
 *      （大摆角球窝关节，锚点贴边必露缝）；源图右臂顶只与躯干重叠 1~2px，
 *      沿轴内扫永远落在躯干外，所以必须二维搜索。
 *
 * 硬保证（用户："最起码各个肢体的关节必须连起来"）：9 个锚点全部落在父/子两张贴图的
 * alpha **内部**（margin ≥ 6px，肩/髋 ≥ 25px），verify-core 钉死这一条。
 * 颈沿用重叠区中心（头是球形，重叠中心已对，余量 99px）。
 */
const ANCHOR_MARGIN: Readonly<Record<string, number>> = {
  shoulder_l: 25, shoulder_r: 25, hip_l: 25, hip_r: 25,
};

/** 关节锚点（画布 px）：优先实测值，缺则回退 parts.json */
function anchorPx(name: string, jm: JointMeta): [number, number] {
  const a = LIMB_AXES.anchors[name];
  return a ? [a[0], a[1]] : [jm.x, jm.y];
}

/**
 * ★ 网络输出的三轴口径（每关节 3 个数，共 27）。
 *   索引 0 = 绕 X（**外展/侧摆**：把下垂的肢体往身体左右两侧抬）
 *   索引 1 = 绕 Y（**扭转**：绕肢体自身长轴转）
 *   索引 2 = 绕 Z（**屈伸**：把下垂的肢体往前后摆 = 迈步的主自由度）
 * 网络输出第 3i+k 个数就是关节 i 第 k 轴的**目标角速度**（tanh 后 × JOINT_MAX_SPEED，
 * 表达在父刚体本地坐标系里）。三个轴的物理含义全靠这一条约定，
 * brain.ts / ragdoll.driveMotors / sim 的输入填装三处必须一致。
 */

/** 每个关节的马达速度上限（rad/s，三轴共用）。这就是"关节转速"的量程 */
export const JOINT_MAX_SPEED = 9.0;

/**
 * 每个关节的最大力矩（N·m）—— 主自由度（屈伸）的量级，取自 MuJoCo humanoid.xml
 * 的 actuator gear。那是人形机器人控制文献里被反复调过的执行器量级
 * （髋 200 / 膝 150 / 肩 100 / 颈(abdomen) 100 / 肘 40），比自己拍脑袋定一个数字靠谱。
 * 本骨架无踝关节（脚与小腿一体化），所以没有 ankle 项。
 */
export const JOINT_MAX_TORQUE: Readonly<Record<string, number>> = {
  neck: 100,
  shoulder_l: 100,
  shoulder_r: 100,
  elbow_l: 40,
  elbow_r: 40,
  hip_l: 200,
  hip_r: 200,
  knee_l: 150,
  knee_r: 150,
  // ★ 踝：比膝小一个量级（踝在人类身上本来就只有膝的 1/5~1/4 力矩），
  //   45 N·m 足够做"勾脚/尖脚"，太大反而会让脚像弹簧一样抽。
  foot_l: 45,   // ★ 会被 cfg.ankleMaxTorque 覆盖
  foot_r: 45,
};

/**
 * 三轴的力矩分配系数（乘在上面那个 τmax 上）。
 * 物理依据：肌肉在屈伸方向出力最大，外展次之，绕长轴的扭转最弱
 * （MuJoCo 的 humanoid 也是给 hip_x / hip_z 远大于 hip_y）。
 * 统一给同一个数会让"扭转"自由度过强 —— 腿会绕自己长轴乱转，看起来像抽筋。
 */
export const TORQUE_AXIS_FACTOR: Vec3 = [0.60, 0.35, 1.00];

/**
 * ★ 次要两轴的限位（度）：[绕 X（外展/侧摆）, 绕 Y（扭转）]，正负对称。
 * 主自由度（绕 Z 的屈伸）不在这里 —— 它来自素材标注的 limitDeg。
 *
 * 取值口径：
 *   肘 / 膝在解剖上是**铰链**，几乎只能屈伸 ⇒ 次要轴压到 6~16°，
 *     这样"膝反折""肘侧掰"这类不物理的姿态不会出现；
 *   颈 / 肩 / 髋是真球窝关节 ⇒ 放到 30~75°。
 *
 * ★ 想让膝盖也变成完整 3 自由度球关节？把 knee_* 的两个数放大即可（一行的事）。
 *   目前故意不放大：无限制的膝关节在 ES 早期会学出"旋转踢腿"这种赖皮步态。
 */
export const JOINT_LIMITS_XY_DEG: Readonly<Record<string, readonly [number, number]>> = {
  neck:       [30, 70],
  shoulder_l: [75, 65],
  shoulder_r: [75, 65],
  elbow_l:    [14, 16],
  elbow_r:    [14, 16],
  hip_l:      [45, 40],
  hip_r:      [45, 40],
  knee_l:     [ 6,  8],
  knee_r:     [ 6,  8],
  // ★★ 踝：**额状面自由度按单腿站立文献放宽**（2026-10-02）。
  //   X = 内翻/外翻（pronation/supination，绕足长轴）；Y = 轴向内外旋。
  //   原值 `[8, 6]` 的注释写"踝的侧向自由度不是走路的主自由度" —— 这在**双脚站立**
  //   成立，但**单腿站立恰恰相反**：
  //     · Liu et al., J Biomech 2012 —— "Unlike double-limb stance during which small
  //       body sway is found primarily in the sagittal plane, **single limb stance** showed
  //       the inter-joint coordination mainly in the **transverse** and **frontal** plane
  //       (ankle and hip internal/external rotations, **ankle inversion/eversion**)"
  //     · 同文给出额状面力学链："the whole body center of mass moves away from the
  //       supporting leg inducing a **lateral bending (hip abduction/adduction) moment
  //       that is equilibrated at the ankle level by supination or pronation of the ankle**
  //       that involves axial rotation"
  //     · 人体踝的被动 ROM：内翻 ~35°、外翻 ~14°；站立期功能性使用更小，
  //       取 **X=±14°（覆盖外翻全范围）/ Y=±10°** 作为可动上限。
  //   ⇒ 侧向自由度不是"放开就会乱翻"，而是**单腿平衡的必要执行器**。
  foot_l:     [14, 10],
  foot_r:     [14, 10],
};

// ---------------------------------------------------------------- 计算后的骨架

/** 一个刚体上的一个碰撞体（含它自己那份质量属性） */
export interface ColliderDef {
  shape: 'capsule' | 'cuboid';
  /** capsule */
  halfHeight: number;
  radius: number;
  /** cuboid */
  hx: number;
  hy: number;
  hz: number;
  /** 相对刚体几何中心的偏移（本地，米） */
  offsetY: number;
  /**
   * ★ 侧向偏移（本地米，+Z）。脚掌要加这个：纹理里画出来的靴子相对小腿中轴是**偏**的
   * （左靴心 x=440px / 右靴心 x=1096px，而小腿中轴在 ~460/~1075px），
   * 盒心挂在中轴上就会偏出靴子外 —— 用户回读："脚部和纹理不太匹配"。
   */
  offsetZ: number;
  /** 本 collider 的质量（kg） */
  mass: number;
  /** 本 collider 的质心（相对它自己原点，本地米） */
  comY: number;
  /** 本 collider 绕 Z 的主惯量（kg·m²） */
  inertiaZ: number;
  /** 本 collider 绕 X/Y 的主惯量（kg·m²） */
  inertiaXY: number;
}

export interface BodyDef {
  key: string;
  bone: string;
  label: string;
  part: PartMeta;
  /** 初始姿态下的刚体几何中心（世界米；y=0 = 地面） */
  cx: number;
  cy: number;
  cz: number;
  /**
   * ★★ 静倾角（绕世界 X 轴，弧度）：刚体局部 +Y 对齐到**贴图实测中轴的近端方向**。
   *
   * 为什么必须有（用户回读 2026-10-01："各个部位都是有一定倾斜度的"）：
   *   实测倾角：上臂 7.3°/2.8°、前臂+手 30.6°/32.2°、大腿 8.0°、小腿 9.2°/7.7°。
   *   刚体原来一律是**竖直胶囊**、贴图板贴在刚体中心且不旋转 ⇒ 渲染时斜肢体被画成正的，
   *   于是前臂/手掌歪 30°、上臂歪 7°，上下臂在肘部错开、接不上。
   *   有了静倾角：刚体朝向 = 静倾角 ⊗ 动力学旋转，胶囊沿实测中轴躺平，
   *   贴图板随刚体一起倾斜 ⇒ **初始姿态就是素材画的那张姿势**。
   *   躯干/头不设（实测倾角 <1°，且脊柱 LBS 蒙皮假设躯干不倾斜）。
   */
  restTiltRad: number;
  /**
   * ★★ 绕竖直轴（世界 Y）的静偏航（弧度）—— 只给两根小腿。
   *
   * 用户定调（2026-10-01）："脚部骨骼向内收一下，现在是从膝关节到脚尖，脚尖朝外侧"。
   * 素材里两只靴子是**外八字**画的（靴底边在画布上斜 −17°/+19°，靴头朝身体外侧），
   * 照搬就是"脚尖朝外"，走路/战斗都是错的站姿。
   * ⇒ 膝盖以下的骨骼整体绕竖直轴向内偏航（左右反向），把脚尖转向正前方。
   * 偏航绕**膝锚点**发生（局部锚点随刚体一起算），所以小腿是"绕膝内收"，不是整体平移。
   * 上臂/前臂/大腿不偏航（手肘的展开是动作，不是静态站姿问题）。
   */
  restYawRad: number;
  /**
   * ★ 贴图板中心相对刚体中心的**局部**偏移（米，刚体局部系）。
   * 肢体刚体中心现在落在中轴中点上，而贴图中心是 bbox 中心（斜肢体的 bbox 中心偏离中轴），
   * 所以要把这段偏移存下来，渲染时 `mesh.position = bodyPos + q·plateOffset`。
   */
  plateOffset: Vec3;
  /**
   * ★ 渲染层跳过这块贴图板（2026-10-01 踝关节）。
   *   脚掌是独立刚体，但它**没有自己的贴图** —— 脚还在小腿那张 PNG 里，
   *   靠渲染层对脚部区域做 UV 扭曲来表现踝的转动。
   */
  plateHidden?: boolean;
  /** 长轴长度（米） */
  length: number;
  /** 主胶囊半径（米） */
  radius: number;
  /** 主胶囊半高（不含两端半球）= length/2 - radius */
  halfHeight: number;
  /** 该刚体总质量（kg，= 各 collider 之和） */
  mass: number;
  /** 该刚体的 collider 列表 */
  colliders: ColliderDef[];
  leg: boolean;
  /**
   * ★ 脊柱分段标记：本刚体是整块躯干护甲在脊柱方向上的第 index 段（0 = 最下 = 骨盆），
   * 共 count 段。**这不是"把贴图切条"** —— 视觉上仍然只有一张完整贴图，
   * viewer.ts 把带该标记的刚体收进**一个**蒙皮 mesh，按此顺序做线性混合蒙皮。
   * 只有躯干分段后（spineSegments > 1）才有值。
   */
  texSlice?: { index: number; count: number };
}

export interface JointDef {
  name: string;
  /** 索引 = JOINT_ORDER 位置 = 马达索引 = 网络输出下标（每关节 3 个输出） */
  index: number;
  parentKey: string;
  childKey: string;
  /** 关节世界锚点（米） */
  wx: number;
  wy: number;
  wz: number;
  /** 锚点相对父 / 子刚体几何中心的偏移（本地米） */
  parentLocal: Vec3;
  childLocal: Vec3;
  /**
   * ★★ 静姿态下的关节角读数（弧度，三轴）—— 关节的"零点偏置"。
   *
   * ragdoll 的 `jointRot` 算的是 `conj(q父) ⊗ q子` 的旋转矢量，而父子刚体**静倾角不同**
   * （上臂 5°、前臂+手 35°、大腿 8°、小腿 0°…），于是素材姿势本身就带一个非零读数
   * （肘 ≈ ∓30°）。左右两侧的偏置**符号相反**（k 是镜像的），而肘/膝限位是**不对称**的
   * ⇒ 马达会把一条胳膊往里掰、另一条往外掰（用户回读："初始状态下两个手臂就一个往外一个往内折了"）。
   * 减去它之后：**关节零位 = 素材画的那张姿势**，软限位/马达/读数三者的参照系一致。
   */
  restRad: Vec3;
  /** 三轴软限位（弧度）：[0]绕X 外展 [1]绕Y 扭转 [2]绕Z 屈伸 */
  minRad: Vec3;
  maxRad: Vec3;
  /** 三轴最大力矩（N·m）= JOINT_MAX_TORQUE × TORQUE_AXIS_FACTOR */
  maxTorque: Vec3;
}

export interface Skeleton {
  cfg: SkeletonConfig;
  /** 像素 → 米 */
  px2m: number;
  /** 画布中线 x（世界 z=0 对应的画布 px） */
  centerPx: number;
  /** 地面在画布里的 y（= 全部组件包围盒底边） */
  groundPx: number;
  bodies: BodyDef[];
  joints: JointDef[];
  /** 整体身高（米，校验用） */
  totalHeight: number;
  massTotal: number;
}

const DEG = Math.PI / 180;

/** 包围盒 → 胶囊：半径取短边一半 × 系数，且不超过长边一半（否则半高变负） */
function capsuleFromBox(w: number, h: number, radiusScale: number) {
  const length = Math.max(w, h);
  const radius = Math.min((Math.min(w, h) / 2) * radiusScale, (length / 2) * 0.92);
  return { length, radius, halfHeight: Math.max(0, length / 2 - radius) };
}

/** 质心相对几何中心的偏移：近端在上时 +Y 朝上，近端在下时 +Y 朝下，见上方推导 */
function comOffset(length: number, comRatio: number, proximal: Proximal): number {
  return proximal === 'top'
    ? length * (0.5 - comRatio)
    : length * (comRatio - 0.5);
}

/**
 * 从元数据 + 配置算出完整骨架。
 * 纯函数：同样输入永远同样输出 —— 离屏验收时可以拿它做断言，不需要开浏览器。
 */
export function buildSkeleton(cfg: SkeletonConfig = DEFAULT_CONFIG): Skeleton {
  const { extent } = META;
  const px2m = cfg.height / extent.h;
  const centerPx = (extent.x0 + extent.x1) / 2;
  const groundPx = extent.y1;

  /** 画布横向 → 世界 Z（侧向）。★ 取负：见文件头"侧向取负" */
  const mapZ = (px: number, applyStance: boolean) =>
    -(px - centerPx) * px2m * (applyStance ? cfg.stance : 1);
  const mapY = (px: number) => (groundPx - px) * px2m;

  const legKeys = new Set(SEGMENTS.filter((s) => s.leg).map((s) => s.key));

  // ---- 脊柱分段（见 SkeletonConfig.spineSegments）----
  const K = Math.max(1, Math.floor(cfg.spineSegments));
  /** 最上一段（胸腔）的 key；颈/肩挂在它上面 */
  const CHEST = K > 1 ? `spine${K}` : 'torso';
  /** 第 s 段（0 = 骨盆）的 key */
  const segKey = (s: number): string => (s === 0 ? 'torso' : `spine${s + 1}`);
  /**
   * ★ 躯干上原有 9 个关节按**锚点高度**自动分配到对应段落（不是按名字硬编码）。
   *   髋的锚点在躯干下端 → 骨盆；颈在最上端 → 胸腔；肩线通常落在胸腔或它下一段，
   *   就近分配才不会把锚点甩到段外（硬编码"颈肩都挂最上段"实测让肩锚点越界 20 mm）。
   */
  let byKeyRef: Map<string, BodyDef> | null = null;
  const attachTo = (parentKey: string, wy: number): string => {
    if (parentKey !== 'torso' || K <= 1 || !byKeyRef) return parentKey;
    let best = 0, bestD = Infinity;
    for (let s = 0; s < K; s++) {
      const b = byKeyRef.get(segKey(s));
      if (!b) continue;
      const d = Math.abs(b.cy - wy);
      if (d < bestD) { bestD = d; best = s; }
    }
    return segKey(best);
  };

  // ---- 脚掌尺寸（画布 px → 米），两个小腿共用 ----
  const soleHalfLen = (META.sole.len * px2m) / 2;
  const soleHalfThick = (META.sole.thick * px2m) / 2;
  /**
   * ★ 脚掌盒的贴地标定（米）：**当前为 0，即不做任何人为修正**。
   *
   * 背景（2026-10-02）：我曾把它设成 0.0536 —— 那是**量错了**得来的。
   * `Ragdoll.footPoint()` 当时无条件用 `shin_l/shin_r` 的 cuboid 当"鞋底"，
   * 踝开启后它量的是**被缩短的小腿**底部，于是报出"+5.36 cm 悬空"。
   * 那个 bug 已修（优先查 `foot_l/foot_r`），所以这个标定值必须撤销 ——
   * 留着它等于把一个 5.36 cm 的错误偏移真正写进几何里。
   * `tools/probe-ankle.ts` 的 A2 段会复核脚底是否真的落在 y=0。
   */
  const SOLE_GROUND_CORR = 0;

  // ---- 刚体 ----
  /**
   * ★ 肢体刚体的静倾角（绕世界 X，弧度）。
   *   画布里肢体的中轴是 x = k·y + b（y 向下），画布 +x 映射到世界 −Z（见 mapZ 的负号），
   *   所以"沿中轴指向近端"的世界方向 ∝ (0, +1, +k·stance)，
   *   而绕 X 转 φ 把局部 +Y 映到 (0, cos φ, sin φ) ⇒ φ = atan(k·stance)。
   *   腿要跟 stance 一起缩（stance<1 时两腿并拢 ⇒ 倾角同步变小），上肢不缩。
   *   躯干/头不设静倾角：实测 <1°，且脊柱段要保持同一朝向才能做 LBS 蒙皮。
   */
  /** 肢体胶囊每端的枢轴余量（米）：铰链枢轴在关节上，允许略微出轮廓 */
  const PIVOT_PAD = 0.015;
  const TILTED = new Set(['arm_l', 'arm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'shin_l', 'shin_r']);
  /**
   * ★ 肢体静倾角 = **该部件贴图自己的实测中轴倾角**（`limbAxes.axes[key].k`），
   *   绕**世界 X 轴**（画布的左右 = 世界侧向 Z）。
   *   · 绕 X ⇒ 正面视图里是斜的（就是素材画的 2D 方向），侧视图里投影到 Y = **竖直**，
   *     这正是用户要的"保留正面的倾斜，侧面是竖直的"。
   *     ⚠ 代码里绝不能出现绕 Z 的肢体倾角 —— 那才会让侧视图歪。
   *   · 唯一的例外是**小腿**：用户定调"从膝关节到脚尖"要走直线（素材小腿外撇 5~6°，
   *     照搬就是"脚尖朝外侧"），所以小腿骨强制铅垂。
   *   · 骨必须**逐段**跟各自纹理的方向（上臂 5°、前臂+手 31°），不能合并成一根直骨：
   *     用户"为什么手臂和纹理侧面方向不一致"就是在指这个。
   *   ★ 倾角只影响骨骼/碰撞体；渲染端 `restVisualQuatOf` 完全补偿 ⇒ 贴图逐像素不动。
   */
  const restTiltOf = (key: string, leg: boolean): number => {
    if (!TILTED.has(key)) return 0;
    if (key === 'shin_l' || key === 'shin_r') return 0;
    const ax = LIMB_AXES.axes[key];
    if (!ax) return 0;
    return Math.atan(ax.k * (leg ? cfg.stance : 1));
  };
  /**
   * ★ 脚掌外八偏航（左右反向）。
   *   `mapZ` 取负 ⇒ 画布 x 小的**左脚在世界 +Z**、右脚在 −Z。
   *   绕 +Y 转 ψ：+X（正前方）→ −Z，所以要让**脚尖朝外侧**，
   *   左脚必须取 **−ψ**、右脚取 **+ψ**（取反就是内八 —— 这个符号错过一次）。
   */
  const restYawOf = (key: string): number => {
    if (key !== 'shin_l' && key !== 'shin_r' && key !== 'foot_l' && key !== 'foot_r') return 0;
    const s = cfg.footSplayDeg * DEG;
    // ★ 脚掌刚体沿用同一套外八偏航（否则踝的静姿态零位会把脚拧回正前方 25°）。
    return key === 'shin_l' || key === 'foot_l' ? -s : s;
  };

  const bodies: BodyDef[] = [];
  for (const spec of SEGMENTS) {
    const part = PART_BY_KEY.get(spec.key);
    if (!part) throw new Error(`[skeleton] parts.json 缺少组件 ${spec.key}`);

    const { length: boxLen, radius, halfHeight: boxHalf } = capsuleFromBox(
      part.bw * px2m, part.bh * px2m, cfg.limbRadiusScale,
    );
    // ★ 肢体刚体中心 = **实测中轴的中点**（不是 bbox 中心）：
    //   锥形肢体的 bbox 中心偏离中轴（上下宽度不等），胶囊躺上去就会偏。
    const ax = LIMB_AXES.axes[spec.key];
    // ★★ 倾斜肢体的胶囊长度改用**实测中轴长度**，不是 bbox 高度。
    //   前臂+手贴图斜 31°：bbox 高只有 0.395 m，而沿骨轴的真实长度 0.407 m ——
    //   用 bbox 高做胶囊，肘锚点（在前臂近端）就顶出胶囊 10.9mm（verify-core 报）。
    //   骨轴长度才是"这根骨头有多长"的正确度量，碰撞体必须按它来。
    let length = boxLen;
    let halfHeight = boxHalf;
    if (ax && TILTED.has(spec.key)) {
      // ★ PIVOT_PAD：铰链枢轴在**关节**上，解剖上略微在肢体轮廓之外
      //   （肘锚点距前臂骨轴中点 205mm，骨轴半长只有 203mm）。给每端留 15mm，
      //   否则 verify-core 的"锚点不越出胶囊"会差 2mm 判失败。
      length = Math.max(boxLen, ax.lenPx * px2m) + 2 * PIVOT_PAD;
      halfHeight = Math.max(1e-3, length / 2 - radius);
    }
    const tilt = restTiltOf(spec.key, !!spec.leg);
    const yaw = restYawOf(spec.key);
    // 物理静姿态 = 倾角 + 偏航（骨骼真的这么摆）
    const qRestInv = invQuatOf(restQuatOf(tilt, yaw));
    // 视觉补偿 = 只有倾角（偏航是主动纠正的站姿，贴图要跟着转）
    const qVisInv = invQuatOf(restVisualQuatOf(tilt));
    let centerY = mapY(part.cy);
    let centerZ = mapZ(part.cx, !!spec.leg);
    if (ax && TILTED.has(spec.key)) {
      const midY = (ax.proxTip[1] + ax.distTip[1]) / 2;
      const midX = (ax.proxTip[0] + ax.distTip[0]) / 2;
      centerY = mapY(midY);
      centerZ = mapZ(midX, !!spec.leg);
    }
    // ★★ 有踝锚点时，小腿刚体只代表"膝→踝"这一段：
    //   原来它居中在**整条小腿（含靴子）**的中点上，加了踝之后必须重新居中，
    //   否则膝锚点会落到胶囊外面 66~70mm（门禁"锚点不越出胶囊"会失败），
    //   物理上也会让膝铰链挂在骨外。
    let footAnkle: [number, number] | null = null;
    if (cfg.ankleEnabled && spec.leg && (spec.soleMassPct ?? 0) > 0) {
      const side2 = spec.key === 'shin_l' ? 'l' : 'r';
      const ak = LIMB_AXES.anchors?.[`foot_${side2}`];
      const kn = LIMB_AXES.anchors?.[`knee_${side2}`];
      if (ak && kn) {
        footAnkle = [kn[0], ak[1]];
        const shankLen = Math.abs(mapY(ak[1]) - mapY(kn[1]));
        const newLen = shankLen + 2 * PIVOT_PAD;
        const newHalfH = Math.max(1e-3, newLen / 2 - radius);
        length = newLen;
        halfHeight = newHalfH;
        centerY = (mapY(kn[1]) + mapY(ak[1])) / 2;
        // ★ 横向对准**膝锚点**（不是膝踝中点）：小腿骨按用户定调是**铅垂**的
        //   （restTiltOf 对 shin 强制 0），而素材里膝→踝是外撇 7.1°（x 527.5→454.5）。
        //   对准膝 ⇒ 膝铰链正好在骨轴上（门禁要求），踝锚点因此横向偏 24mm
        //   —— 父骨侧的弯折偏置，门禁本来就允许（膝对大腿也有 16mm）。
        centerZ = mapZ(kn[0], true);
      }
    }
    // 贴图板中心（bbox 中心）在"视觉静姿态"局部系里的偏移
    const plateOffset = rotVecByQuat(
      qVisInv,
      [0, mapY(part.cy) - centerY, mapZ(part.cx, !!spec.leg) - centerZ],
    );
    const cy = centerY;

    const totalMass = (spec.massPct / 100) * cfg.mass;
    const solePct = spec.soleMassPct ?? 0;
    const mainMass = totalMass - (solePct / 100) * cfg.mass;

    const colliders: ColliderDef[] = [];

    // 主胶囊（★ 长度/中心已按"膝→踝"重算过）
    const mainCom = comOffset(length, spec.comRatio, spec.proximal);
    const mainIz = mainMass * Math.pow(spec.gyrationRatio * length, 2);
    colliders.push({
      shape: 'capsule',
      halfHeight, radius,
      hx: 0, hy: 0, hz: 0,
      offsetY: 0, offsetZ: 0,
      mass: mainMass,
      comY: mainCom,
      inertiaZ: mainIz,
      inertiaXY: mainIz * 0.5,
    });

    // ★★ 脚掌：同一刚体上的第二个 collider，**按纹理实测的靴子摆**（用户回读 2026-10-01：
    //   "脚部和纹理不太匹配"）。原来这里是三个各猜各的：
    //     · 盒心挂在小腿胶囊正中         → 但画出来的靴子相对小腿中轴是偏的（偏 20~30px）
    //     · 侧向半宽 = capsuleRadius·0.9  → 而靴子实测侧向半宽 165/153px，比它宽 60%
    //     · 盒底 = 胶囊底端               → 胶囊底端在小腿 bbox 底，靴底比它高 7px
    //   现在（`limbAxes.paw`，measure-limb-axes.py 实测）：
    //     · 盒心侧向 = 靴心 x（吃 stance，与整条腿一致）
    //     · 盒心竖向 = 盒底贴地（世界 Y = hy），不再用"胶囊底端"倒推
    //     · 侧向半宽 = 实测 lateralHalf × soleFootScale
    //   前后长度（hx）仍是手填设计参数：正面视图**测不出**脚的前后长度（见 soleFootScale 注释）。
    if (solePct > 0) {
      const soleMass = (solePct / 100) * cfg.mass;
      const sfx = Math.max(0.1, cfg.soleFootScale);
      const side = spec.key === 'shin_l' ? 'l' : 'r';
      const paw = LIMB_AXES.paw?.[side];
      const knee = LIMB_AXES.anchors?.[spec.key === 'shin_l' ? 'knee_l' : 'knee_r'];
      const anklePx = LIMB_AXES.anchors?.[spec.key === 'shin_l' ? 'foot_l' : 'foot_r'];
      const hx = soleHalfLen * sfx;
      // 侧向半宽用**实测靴宽**（前后长度 hx 仍是手填设计参数：正面视图测不出脚长）
      const hz = (paw ? paw.lateralHalf * px2m : radius * 0.9) * sfx;
      // ★ 盒心横向 = **膝锚点正下方**（膝到脚尖铅垂），不是画出来的靴心：
      //   素材靴心比膝锚点外偏 60~100px，那正是"外八"；盒心挂靴心 ⇒ 膝到脚尖朝外。
      //   脚尖朝向由 `footSplayDeg`（外八）单独控制，两者互不干涉。
      //   盒宽取实测靴宽，所以盒子会从靴子内侧探出去一点 —— 这是"骨骼正确、纹理不动"
      //   的必然代价（线框视图可见），已在文档里记明。
      const soleWorldY = soleHalfThick;
      // ★ 保持"盒心吊在膝正下方"这个既有约定（外八由 footSplayDeg 单独控制）。
      //   ⚠ 我曾把它改成用踝锚点（想修踝开启时站距偏宽 9.4 cm），
      //   但 `soleWorldZ` 在**踝关闭路径**上也被用到 —— 一改就把踝关时的几何也带偏了，
      //   连带 `gaitref`（髋符号）、`settle`/`gaitcycle`（MoS 项归零）、
      //   `verify`（重放逐位一致）三条门禁搞红。已回退。
      //   踝开启时的站距问题改由"碰撞体偏移取纯 y"那一处解决（见下面）。
      const soleWorldZ = mapZ(knee ? knee[0] : part.cx, true);
      const soleMassTotal = mainMass + soleMass;
      void soleMassTotal;

      // ═══ ★★ 2026-10-01：脚掌拆成**独立刚体**，用踝 revolute 接在小腿上 ═══
      //   之前这里是"小腿刚体上的第二个 collider"：脚和腿同一个刚体 ⇒ 脚**不能主动转**，
      //   于是勾脚/尖脚/落脚全做不到（这是 6 s 必倒的结构性原因，见架构设计 §12.5）。
      //   视觉上脚仍在小腿贴图里，由渲染层的**脚部 UV 扭曲**跟着踝角走。
      if (anklePx && cfg.ankleEnabled) {
        const ankleY = mapY(anklePx[1]);
        const ankleZ = mapZ(anklePx[0], true);
        // 脚掌刚体中心 = 踝锚点（局部原点在锚点上，盒体用 offsetY 往下偏）
        const fTilt = 0;                       // 脚掌在物理里保持水平（盒底贴地）
        const fYaw = restYawOf(spec.key === 'shin_l' ? 'foot_l' : 'foot_r');
        const fQInv = invQuatOf(restQuatOf(fTilt, fYaw));
        // ★ 脚掌盒从**踝一直罩到鞋底**（不是只盖鞋底那一片）：
        //   ① 踝锚点必须落在自己刚体的碰撞体内，否则门禁"锚点不越出胶囊"必失败，
        //      物理上踝也确实在脚掌实体的上端；
        //   ② 只留鞋底一片的话，脚掌和地面之间会有一条"薄片"，蹬地时几乎没有支撑面。
        // ★★ 碰撞体是**薄鞋底板**，不是"从踝罩到鞋底的高盒"。
        //  踩过的坑：高盒绕**盒子顶部**的踝旋转时，底角会扎进地面
        //   （25° ⇒ 21mm），踝被地面反力锁死、腿一推就倒（实测位移 1.25 m → 0.08 m、
        //   ES 完全学不动，膝跟踪误差 −13）。真实机器人也是这么建的：
        //   脚掌 = 一块平底板，踝关节在它**上方**约 6cm（MuJoCo/MIT Cheetah 同款做法）。
        const soleDrop = ankleY;                              // 踝离地高度（米）
        const fMidY = soleWorldY;                             // 盒心高度 ⇒ 盒底正好落地
        // ★★ 碰撞体偏移**只取 y**：脚掌本来就吊在踝正下方。
        //   原来还带一个 z 分量（`soleWorldZ − ankleZ`，即"膝到踝的外八差"），
        //   但 `rotVecByQuat(fQInv, …)` 会把它按脚掌的**外八偏航（≈25°）**旋转：
        //   Ry 把 z 分量乘 cos25°=0.906 并漏出一个 x 分量 ⇒ 脚底实际落在
        //   ±0.2103 而不是目标的 ±0.1635 ⇒ **站距凭空宽 9.4 cm**，
        //   支撑面与质心的关系全变（踝一开 2 秒必倒，与 kP/kD 无关）。
        //   偏航只该影响脚掌的**朝向**（由 restYawOf 决定），不影响它的**位置**。
        const local = rotVecByQuat(fQInv, [0, fMidY - ankleY - SOLE_GROUND_CORR, 0]);
        bodies.push({
          key: spec.key === 'shin_l' ? 'foot_l' : 'foot_r',
          bone: spec.bone,
          label: spec.key === 'shin_l' ? '左脚掌' : '右脚掌',
          part,                       // 贴图仍借小腿那张（渲染层按脚部区域做 UV 扭曲）
          cx: 0,
          cy: ankleY,
          cz: ankleZ,
          restTiltRad: fTilt,
          restYawRad: fYaw,
          // 贴图板偏移：脚掌**不单独画贴图** ⇒ 用一个大偏移把它藏到小腿板之外
          plateOffset: [0, 0, 0],
          plateHidden: true,          // ★ 渲染层据此跳过这块板
          length: soleDrop,
          radius: 0,
          halfHeight: soleDrop / 2,
          mass: soleMass,
          colliders: [{
            shape: 'cuboid',
            halfHeight: 0, radius: 0,
            hx, hy: soleHalfThick, hz,
            offsetY: local[1], offsetZ: local[2],
            mass: soleMass,
            comY: 0,
            inertiaZ: (soleMass * (hx * hx + soleHalfThick * soleHalfThick)) / 3,
            inertiaXY: (soleMass * (hz * hz + soleHalfThick * soleHalfThick)) / 3,
          }],
          leg: true,
        });
        // ★ 小腿胶囊**只到踝**（上面已把刚体中心/长度重算到"膝→踝"这一段），
        //   靴子那段归脚掌刚体 ⇒ 小腿胶囊不会戳到地面、也不与脚掌盒互穿。
        bodies.push({
          key: spec.key,
          bone: spec.bone,
          label: spec.label,
          part,
          cx: 0,
          cy,
          cz: centerZ,
          restTiltRad: tilt,
          restYawRad: yaw,
          plateOffset,
          length,
          radius,
          halfHeight,
          mass: mainMass,
          colliders: [colliders[0]],
          leg: true,
        });
        continue;
      }

      // ---- 兜底：没有踝锚点数据时维持旧行为（脚掌作为第二 collider 挂在小腿上）----
      const local = rotVecByQuat(qRestInv, [0, soleWorldY - centerY, soleWorldZ - centerZ]);
      colliders.push({
        shape: 'cuboid',
        halfHeight: 0, radius: 0,
        hx, hy: soleHalfThick, hz,
        offsetY: local[1], offsetZ: local[2],
        mass: soleMass,
        comY: 0,
        inertiaZ: (soleMass * (hx * hx + soleHalfThick * soleHalfThick)) / 3,
        inertiaXY: (soleMass * (hz * hz + soleHalfThick * soleHalfThick)) / 3,
      });
    }

    // ★★ 躯干沿脊柱切成 K 段（用户定调：身体也要像脊椎一样有很多关节）。
    //   段 0 的 key 仍然是 'torso' ⇒ torso() / 适应度 / 相机 的语义完全不变。
    if (spec.key === 'torso' && K > 1) {
      const segLen = length / K;
      const segMass = totalMass / K;
      const hx = radius, hz = radius * 0.9;
      for (let s = 0; s < K; s++) {
        const cyS = cy - length / 2 + (s + 0.5) * segLen;
        // 盒式惯量（每段自己的主惯量；段间的平行轴项由动力学自动承担）
        const iZ = (segMass * (hx * hx + (segLen / 2) * (segLen / 2))) / 3;
        const iX = (segMass * ((segLen / 2) * (segLen / 2) + hz * hz)) / 3;
        bodies.push({
          key: s === 0 ? 'torso' : `spine${s + 1}`,
          bone: spec.bone,
          label: s === 0 ? '骨盆' : `脊椎${s + 1}`,
          part,
          cx: 0,
          cy: cyS,
          cz: mapZ(part.cx, false),
          restTiltRad: 0,          // 躯干不设静倾角（脊柱段要同朝向才能 LBS）
          restYawRad: 0,
          plateOffset: [0, 0, 0],  // 蒙皮板由 viewer 逐段插值，不用刚体中心
          length: segLen,
          radius,
          halfHeight: segLen / 2,
          mass: segMass,
          colliders: [{
            shape: 'cuboid',
            halfHeight: 0, radius: 0,
            hx, hy: segLen / 2, hz,
            offsetY: 0, offsetZ: 0,
            mass: segMass,
            comY: 0,
            inertiaZ: iZ,
            inertiaXY: iX,
          }],
          leg: false,
          texSlice: { index: s, count: K },
        });
      }
      continue;
    }

    bodies.push({
      key: spec.key,
      bone: spec.bone,
      label: spec.label,
      part,
      cx: 0, // ★ 素材是正面视图，没有深度信息 ⇒ 前向一律 0
      cy: centerY,
      cz: centerZ,
      restTiltRad: tilt,
      restYawRad: yaw,
      plateOffset,
      length,
      radius,
      halfHeight,
      mass: totalMass,
      colliders,
      leg: !!spec.leg,
    });
  }
  const byKey = new Map(bodies.map((b) => [b.key, b]));
  byKeyRef = byKey;

  // ---- 关节 ----
  const jointMetaByName = new Map<string, JointMeta>(META.joints.map((j) => [j.name, j]));
  const joints: JointDef[] = [];
  // ★ 踝关节受 `ankleEnabled` 控制（默认关）。JOINT_ORDER 里始终有 foot_l/foot_r
  //   （网络维度按它算，保持稳定），关掉时**不建这两个关节**、脚掌也不拆成独立刚体。
  const JOINT_ORDER_ACTIVE = JOINT_ORDER.filter((n) => cfg.ankleEnabled || !n.startsWith('foot_'));
  JOINT_ORDER_ACTIVE.forEach((name, index) => {
    const jm = jointMetaByName.get(name);
    if (!jm) throw new Error(`[skeleton] parts.json 缺少关节 ${name}`);
    // ★ 踝关节的子刚体是"脚掌"：它**没有自己的贴图**（脚还在小腿那张 PNG 里），
    //   所以 PART_BY_KEY 里查不到 —— 借用小腿的部件元数据即可（渲染层会跳过它的板）。
    const isAnkle = jm.child === 'foot_l' || jm.child === 'foot_r';
    const childPart = PART_BY_KEY.get(jm.child) ?? PART_BY_KEY.get(isAnkle ? jm.parent : '');
    if (!childPart) throw new Error(`[skeleton] 关节 ${name} 的子部件元数据不存在`);

    // ★★ 锚点 = limbAxes.json 的实测值（见 ANCHOR_MARGIN 上方的说明）：
    //   源图的肢体是**斜的**，bbox 重叠区中心对深重叠关节（肩/髋）是错的；
    //   实测锚点保证落在父/子两张贴图 alpha 内部 ⇒ 关节连得上。
    const [axPx, ayPx] = anchorPx(name, jm);
    const parent = byKey.get(attachTo(jm.parent, mapY(ayPx)));
    const child = byKey.get(jm.child);
    if (!parent || !child) throw new Error(`[skeleton] 关节 ${name} 的刚体不存在`);

    // ★ 锚点收窄必须与子环节一致：否则髋/膝锚点会飘到收窄后的刚体之外
    const stanceHere = legKeys.has(jm.child);
    const wx = 0;
    // ★★ 腿段拉伸（2026-10-02）：素材的**髋高 0.849 m 大于腿长 0.785 m**
    //   ⇒ 站直时膝天生折 ~30°，腿/髋 = 0.92 低于人体常态 0.95~1.0。
    //   实测后果：躯干持续前倾 35.8°、CoM 前移 0.46 m、平衡门因此永远不放行。
    //   `legStretch` 把**膝/踝锚点相对髋下沉**，把腿等比拉长到 leg/hip ≈ 0.97。
    //   （另一种是降髋锚点，但那会让大腿根部脱开素材 88mm；拉伸只动 39mm。）
    const stretch = /^(knee|foot)_/.test(name) ? cfg.legStretch : 0;
    const wy = mapY(ayPx) - stretch * (legKeys.has(jm.parent) ? 1 : 0);
    const wz = mapZ(axPx, stanceHere);

    const xy = JOINT_LIMITS_XY_DEG[name] ?? [20, 20];
    const flexMin = jm.limitDeg[0] * DEG;
    const flexMax = jm.limitDeg[1] * DEG;
    // ★ 踝力矩上限：`cfg.ankleTorque`（A 方案核心参数，默认 45 太小，见 SkeletonConfig 注释）
    const tau = /^(foot|ankle)_/.test(name) ? cfg.ankleTorque : (JOINT_MAX_TORQUE[name] ?? 100);

    // ★ 局部锚点 = 把世界偏移转到该刚体的局部系（要扣掉它的静倾角，
    //   否则带倾角的肢体上，Rapier 会在错误的点上建铰链 ⇒ 一 reset 就错位）。
    const dParent = rotVecByQuat(invQuatOf(restQuatOf(parent.restTiltRad, parent.restYawRad)),
      [wx - parent.cx, wy - parent.cy, wz - parent.cz]);
    const dChild = rotVecByQuat(invQuatOf(restQuatOf(child.restTiltRad, child.restYawRad)),
      [wx - child.cx, wy - child.cy, wz - child.cz]);

    joints.push({
      name,
      index,
      parentKey: parent.key,
      childKey: child.key,
      wx, wy, wz,
      parentLocal: dParent,
      childLocal: dChild,
      // ★ 静姿态读数（父静姿态⁻¹ ⊗ 子静姿态），ragdoll 用它把关节零位挪到素材姿势
      restRad: quatToRotVec(quatRel(
        restQuatOf(parent.restTiltRad, parent.restYawRad),
        restQuatOf(child.restTiltRad, child.restYawRad),
      )),
      minRad: [-xy[0] * DEG, -xy[1] * DEG, flexMin],
      maxRad: [xy[0] * DEG, xy[1] * DEG, flexMax],
      maxTorque: [tau * TORQUE_AXIS_FACTOR[0], tau * TORQUE_AXIS_FACTOR[1], tau * TORQUE_AXIS_FACTOR[2]],
    });
  });

  // ---- ★ 脊柱关节（K−1 个）：连接相邻两段，锚点在两段的交界面上 ----
  if (K > 1) {
    const SPINE_XY_DEG: readonly [number, number] = [15, 20];   // [侧倾, 扭转]
    const SPINE_FLEX_DEG: readonly [number, number] = [-25, 25];
    const SPINE_TAU = 120;
    for (let s = 0; s < K - 1; s++) {
      const p = byKey.get(segKey(s));
      const c = byKey.get(segKey(s + 1));
      if (!p || !c) throw new Error(`[skeleton] 脊柱段 ${s} 不存在`);
      const wy = (p.cy + c.cy) / 2;      // 两段是紧邻的，交界面就在两个中心的中间
      const wx = 0, wz = 0;
      joints.push({
        name: `spine${s + 1}`,
        index: joints.length,             // ★ 接在 JOINT_ORDER 之后 = 网络输出接在后面
        parentKey: p.key,
        childKey: c.key,
        wx, wy, wz,
        parentLocal: [wx - p.cx, wy - p.cy, wz - p.cz],
        childLocal: [wx - c.cx, wy - c.cy, wz - c.cz],
        restRad: [0, 0, 0],   // 躯干段无静倾角 ⇒ 关节零位就是素材姿势
        minRad: [-SPINE_XY_DEG[0] * DEG, -SPINE_XY_DEG[1] * DEG, SPINE_FLEX_DEG[0] * DEG],
        maxRad: [SPINE_XY_DEG[0] * DEG, SPINE_XY_DEG[1] * DEG, SPINE_FLEX_DEG[1] * DEG],
        maxTorque: [
          SPINE_TAU * TORQUE_AXIS_FACTOR[0],
          SPINE_TAU * TORQUE_AXIS_FACTOR[1],
          SPINE_TAU * TORQUE_AXIS_FACTOR[2],
        ],
      });
    }
  }

  const massTotal = bodies.reduce((s, b) => s + b.mass, 0);

  return {
    cfg,
    px2m,
    centerPx,
    groundPx,
    bodies,
    joints,
    totalHeight: extent.h * px2m,
    massTotal,
  };
}

/** 自检：环节质量比之和必须恰好 100%，否则说明 Dempster 表抄错了 */
export function assertMassBudget(): number {
  const sum = SEGMENTS.reduce((s, x) => s + x.massPct, 0);
  if (Math.abs(sum - 100) > 1e-6) {
    throw new Error(`[skeleton] 环节质量比之和 = ${sum}%，应为 100%`);
  }
  return sum;
}

/** 自检：每个刚体的 collider 质量之和必须等于该环节的质量（防止脚掌漏给/多给质量） */
export function assertColliderMass(sk: Skeleton): void {
  for (const b of sk.bodies) {
    const s = b.colliders.reduce((a, c) => a + c.mass, 0);
    if (Math.abs(s - b.mass) > 1e-9) {
      throw new Error(`[skeleton] ${b.key} collider 质量和 ${s} ≠ 刚体质量 ${b.mass}`);
    }
  }
}

/**
 * 自检：关节锚点必须落在父子刚体的胶囊范围内（三维）。
 * 2D 版只校 Y，3D 之后必须连 Z 一起校 —— 侧向锚点飘出去的话，
 * 球关节会把父子刚体硬拽在一起，初始姿态就会自己抖起来。
 */
export function assertJointAnchors(sk: Skeleton): number {
  let worst = 0;
  for (const j of sk.joints) {
    const p = sk.bodies.find((b) => b.key === j.parentKey)!;
    const c = sk.bodies.find((b) => b.key === j.childKey)!;
    for (const [b, l, tag] of [[p, j.parentLocal, 'P'], [c, j.childLocal, 'C']] as const) {
      // 允许偏离：胶囊半径 + 两端半球（= 半高 + 半径）
      const reach = b.halfHeight + b.radius;
      const d = Math.hypot(l[0], l[1], l[2]);
      const over = d - reach;
      if (over > worst) worst = over;
      if (over > 1e-4) {
        // eslint-disable-next-line no-console
        console.log(`      [越界] ${j.name}.${tag} 局部(${l.map((v) => (v * 1000).toFixed(0)).join(',')})mm `
          + `|d|=${(d * 1000).toFixed(1)}mm > reach=${(reach * 1000).toFixed(1)}mm  越 ${(over * 1000).toFixed(1)}mm`);
      }
    }
  }
  return worst;
}
