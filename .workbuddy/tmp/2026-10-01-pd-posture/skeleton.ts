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

import { META, PART_BY_KEY, type JointMeta, type PartMeta } from './partsMeta';

// ---------------------------------------------------------------- 配置

/** 三轴量（X / Y / Z），语义见文件头的轴约定 */
export type Vec3 = readonly [number, number, number];

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
];

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

  // ---- 刚体 ----
  const bodies: BodyDef[] = [];
  for (const spec of SEGMENTS) {
    const part = PART_BY_KEY.get(spec.key);
    if (!part) throw new Error(`[skeleton] parts.json 缺少组件 ${spec.key}`);

    const { length, radius, halfHeight } = capsuleFromBox(
      part.bw * px2m, part.bh * px2m, cfg.limbRadiusScale,
    );
    const cy = mapY(part.cy);

    const totalMass = (spec.massPct / 100) * cfg.mass;
    const solePct = spec.soleMassPct ?? 0;
    const mainMass = totalMass - (solePct / 100) * cfg.mass;

    const colliders: ColliderDef[] = [];

    // 主胶囊
    const mainCom = comOffset(length, spec.comRatio, spec.proximal);
    const mainIz = mainMass * Math.pow(spec.gyrationRatio * length, 2);
    colliders.push({
      shape: 'capsule',
      halfHeight, radius,
      hx: 0, hy: 0, hz: 0,
      offsetY: 0,
      mass: mainMass,
      comY: mainCom,
      inertiaZ: mainIz,
      inertiaXY: mainIz * 0.5,
    });

    // ★ 脚掌：同一个刚体上的第二个 collider，底面与胶囊底端齐平
    if (solePct > 0) {
      const soleMass = (solePct / 100) * cfg.mass;
      const offsetY = -length / 2 + soleHalfThick; // 相对刚体几何中心
      colliders.push({
        shape: 'cuboid',
        halfHeight: 0, radius: 0,
        hx: soleHalfLen, hy: soleHalfThick, hz: radius * 0.9,
        offsetY,
        mass: soleMass,
        comY: 0, // 脚掌自己的质心就在它中心；到刚体总质心的平行轴项由 Rapier 承担
        inertiaZ: (soleMass * (soleHalfLen * soleHalfLen + soleHalfThick * soleHalfThick)) / 3,
        inertiaXY: (soleMass * (radius * radius * 0.81 + soleHalfThick * soleHalfThick)) / 3,
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
          length: segLen,
          radius,
          halfHeight: segLen / 2,
          mass: segMass,
          colliders: [{
            shape: 'cuboid',
            halfHeight: 0, radius: 0,
            hx, hy: segLen / 2, hz,
            offsetY: 0,
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
      cy: mapY(part.cy),
      cz: mapZ(part.cx, !!spec.leg),
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
  JOINT_ORDER.forEach((name, index) => {
    const jm = jointMetaByName.get(name);
    if (!jm) throw new Error(`[skeleton] parts.json 缺少关节 ${name}`);
    const parent = byKey.get(attachTo(jm.parent, mapY(jm.y)));
    const child = byKey.get(jm.child);
    if (!parent || !child) throw new Error(`[skeleton] 关节 ${name} 的刚体不存在`);

    // ★ 锚点收窄必须与子环节一致：否则髋/膝锚点会飘到收窄后的刚体之外
    const stanceHere = legKeys.has(jm.child);
    const wx = 0;
    const wy = mapY(jm.y);
    const wz = mapZ(jm.x, stanceHere);

    const xy = JOINT_LIMITS_XY_DEG[name] ?? [20, 20];
    const flexMin = jm.limitDeg[0] * DEG;
    const flexMax = jm.limitDeg[1] * DEG;
    const tau = JOINT_MAX_TORQUE[name] ?? 100;

    joints.push({
      name,
      index,
      parentKey: parent.key,
      childKey: child.key,
      wx, wy, wz,
      parentLocal: [wx - parent.cx, wy - parent.cy, wz - parent.cz],
      childLocal: [wx - child.cx, wy - child.cy, wz - child.cz],
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
    for (const [b, l] of [[p, j.parentLocal], [c, j.childLocal]] as const) {
      // 允许偏离：胶囊半径 + 两端半球（= 半高 + 半径）
      const reach = b.halfHeight + b.radius;
      const d = Math.hypot(l[0], l[1], l[2]);
      const over = d - reach;
      if (over > worst) worst = over;
    }
  }
  return worst;
}
