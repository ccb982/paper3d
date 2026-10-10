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
   * ★ 裁剪线相对**踝锚点**上移多少（米，随 `ankleEnabled` 生效）。
   *
   * 小腿贴图沿高度被切成两块（踝以上 = 小腿板、踝以下 = 脚掌板）。
   * 切线不放在踝锚点上，而是**往上挪**一段，好让脚掌板把靴子上方那圈
   * 脚踝/袜口也带上——素材里靴子的上沿本来就比踝锚点高一点，按锚点切会
   * 把靴子上沿切掉一截，视觉上脚会"太短"。
   *
   * ★ 物理高度不变（脚掌刚体与碰撞体完全不受它影响），**只影响贴图裁剪**。
   */
  footCropUpMm: number;
  /**
   * ★ 裁剪线两侧各留多少**冗余**（米，随 `ankleEnabled` 生效）。
   *
   * 小腿板下沿和脚掌板上沿各自越过切线这么多 ⇒ 两块**重叠** `2×` 该值。
   * 重叠区的像素来自同一张贴图、位置完全重合 ⇒ 静止时看不出接缝；
   * 好处是踝关节转动/两板相对位姿有微小误差时**不会露缝**，也容得下
   * "踝锚点测偏了"这种误差（用户 2026-10-04：给两边都留点冗余）。
   */
  footCropOverlapMm: number;
  /**
   * ★ 同上，但按**脚掌板高度的比例**给（随 `ankleEnabled` 生效）。
   *
   * 加高踝线时，**绝对毫米往往跟不上**——脚掌板从 100mm 长到 200mm，
   * 固定 10mm 的冗余在比例上就薄了一半。所以这里再给一个比例旋钮，
   * 两者取**较大值**生效 ⇒ 踝线抬高时冗余自动按比例跟着长。
   */
  footCropOverlapFrac: number;
  /**
   * ★ 足底贴地标定（米，随 `ankleEnabled` 生效）：脚掌刚体额外**下沉**多少。
   *
   * ⚠⚠ **本轮实测结论：几何本来是精确的，这个修正 unnecessary 且默认应为 0。**
   *   我曾以为静止时 `soleY = −17.2mm`（踝关时 −2.0mm）是"脚底建模埋进地面"，
   *   于是加了这个旋钮去修。**那个诊断是错的**：
   *     · 几何核对：`foot_l` 的 `cy = 0.06861`、碰撞体 `offsetY − hy = −0.06861`
   *       ⇒ 局部足底恰好抵消 `cy` ⇒ **世界 y = 0，精确**；
   *     · 外八假设也被否证：`footSplayDeg` 从 0° 扫到 25°，`soleY` 恒为 −17.2mm；
   *     · 旋钮扫 0→35mm，`soleY` 只动 0.4mm —— 因为刚体只是沉到同一个
   *       **接触求解平衡点**（Rapier 的 `allowedLinearError`，压 17mm 属正常）。
   *   ⇒ 保留参数作为标定口（万一将来真需要），但默认 0，且**不要再拿 `soleY`
   *     的负值当成建模缺陷的证据** —— 先分清"几何错"与"求解器穿透"。
   */
  soleGroundCorr: number;
  /**
   * ★ 脚掌碰撞体**拆成两块**（脚跟 + 前脚掌），随 `ankleEnabled` 生效。
   *
   * 为什么（实测依据）：单块刚性脚掌平放时，接触形心**不随倾转移动** ——
   *   要让 CoP 移动只能把脚**翻到边缘**。而几何上刚好卡死：
   *     半宽 `hz = 102mm`，滚转上限 14° ⇒ 内侧缘抬 `102·sin14° = 25mm`，
   *     而脚半厚 `hy = 26mm` ⇒ 滚到限位才刚刚好触边。
   *   实测滚转 −0.2…+0.24 rad 全程 **CoP 只动 4 mm**（等于零权限）。
   * 拆成两块后，载荷在脚跟↔前脚掌之间**连续**转移 ⇒ CoP 沿足长连续可调。
   *
   * 单块（`false`）保留以便 A/B 对照。
   */
  soleSplit: boolean;
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
  /**
   * ★★ 踝**屈伸机械硬限位**（度），独立于素材的 `limitDeg`。
   *
   *   为什么需要（用户 2026-10-04：「需要给脚踝加限位，脚踝这个位置受力很大」）：
   *     素材 `limitDeg` 给出的是**画出来的姿态范围**，不是**力学承载范围**。
   *     实测：开VIP 踝刚度后（`K_a = 0.88·K_crit`），踝屈伸轴冲到 **−35°**，
   *     而当时生效的限位只有 `[−10°, +18°]` ⇒ **超限 17°**。
   *     而踝是**唯一**能把地面反力作用点（CoP）搬动的执行器，
   *     它一旦被甩出去，CoP 就跟着跑到接触面外 ⇒ 脚翻 ⇒ 崴脚。
   *     现实里踝之所以能扛住这么大力矩，是因为**副韧带/肌腱把活动度限死**、
   *     且距骨滑车（trochlea）在背屈时**楔紧**（mortise 的几何锁定）。
   *     ⇒ 这里给它一个**比素材更紧的硬限位**，模拟那个几何锁定。
   *
   *   取值按文献的踝 ROM 与本 rig 的力学需求：
   *     · 背屈（勾脚，勾脚尖向下）**−12°** —— 略宽于素材的 −10°，
   *       因为摆动相踝背屈要能跟住腿（Front Neurorob 2022：摆动相 ~7.2°，
   *       蹬离相跖屈 ~17.2° ⇒ 背屈留到 −12° 足够）
   *     · 跖屈（尖脚，蹬地）**+18°** —— 与素材一致，对应文献的 17.2°
   *   ⇒ 总活动度 30°，而 VIP 刚度实测只需要约 12.5°（= τmax/K_a）⇒ **有余量**。
   *
   *   ⚠ 这**只限活动度，不限力矩**。力矩上限由 `ankleTorque`（默认 120N·m）管。
   */
  ankleLimitDeg: readonly [number, number];

  /**
   * ★ 前足刚体的**中足关节**在足长上的相对位置（0 = 足跟端，1 = 脚尖端）。
   *
   *   柔性足 F1（2026-10-04）：前足独立成刚体后需要一个中足关节位置。
   *   解剖上跖跗关节约在足长 35~40% 处；这里默认 **0.5**（几何中心）——
   *   取几何中心是为了让两段等长、力臂对称，**不是**解剖值。
   *   ⚠ 它只影响「中足关节装在哪」，**不影响**侧向 CoP 的总权限
   *     （那由前足绕足长轴的旋前/旋后幅度决定）。
   */
  forefootAtFrac: number;

  /**
   * ★ 中足关节（距下关节）的**旋前/旋后行程**（度，±对称）。
   *
   *   人体被动 ROM：内翻 ~35°、外翻 ~14°（见 `JOINT_LIMITS_XY_DEG` 的踝条目注释）。
   *   柔性足 F1 取 **±12°**：站立期功能性使用远小于被动 ROM，
   *   而**过大的行程会让前足在接触面上打滑**（实测前足 collider 只有 26mm 厚）。
   */
  midfootPronDeg: number;
  /** 内外翻余量（外八已经在静姿态偏航里） */
  ankleRollDeg: number;
  ankleTorque: number;
  /**
   * ★ 髋**外展轴**的 τmax = `JOINT_MAX_TORQUE.hip × hipAbdTorqueFactor`。
   * 1.00 = 与屈伸轴同量级（200 N·m）；**0.60 = 原值（120 N·m），当前默认**。
   *
   * ⚠ 曾把它放到 1.00（撤掉"不超人"余量），实测**反而更差**：15 档刚度/阻尼
   *   组合全部驻留 0.00s、最小 X3 大多 161mm；而 τmax=120 时同一律能到
   *   **驻留 0.42s / 最小 X3 = 2mm**。
   * ⇒ **髋外展权限不是瓶颈**，多给它会冲过目标。Inman 的静态需求 112 N·m
   *   在 120 时已占 93%，实测那个"看起来不够"的余量恰好够用。
   */
  hipAbdTorqueFactor: number;
  /** 弓关节限位（deg）：[旋后, 旋前]。默认 [-4, 16]；见 `arch_*` 处的取舍说明 */
  archLimitDeg: readonly [number, number];
  /** 弓关节锚点沿足长的位置（0=足跟端, 1=脚尖端）。默认 0.22 */
  archAtFrac: number;
  /**
   * 内侧弓顶点离地高度（米）。**实测定为 6mm，不是人体解剖值 20~25mm** ——
   *
   * 理由（`probe-archrise` 实测）：弓区在内侧（fz .40..1.00），承重窄条在外侧
   * （fz ≈−63mm），两者间距 126mm ⇒ 把弓压到地面需旋前 `asin(rise/126)`。实测：
   *   `rise=22mm → 需 10.1°，脚实测只倾 0.33° → 弓接触 0%`（弓悬空）
   *   `rise=4mm  → 需 1.8°`  → 仍接触 0%（尚不够）
   *   `rise=0mm  → 需 0°    → 接触 100%、弓转 0.56°、**CoP 行程 15 → 38.9mm**`✅
   * ⇒ 6mm 是「保留可见弧形」与「等重心侧移给出约 2.7° 旋前后就能接合」的
   *   交界值。它**依赖中台目标**（中台未完成），不能当作已验收。
   * 历史价值：人体惠态弧高 20~25mm，但那是**卷空时**的弧高；
   *   承重下内侧弧会明显压扁。本 rig 承重时弓角只能转 0.56°，
   *   故取 6mm。
   * 人体弧高（仅作背景）：
   * 但**不能直接拿来当稳态值**：它必须小到脚能旋前到的量，
   * 否则弓永远悬空、灵性足退化为“多两块碰撞体的刚性脚”。用 `probe-archwork` 扫。
   */
  archRise: number;
  /**
   * ★ 鞋底分块之间的记缝（米，每块两侧各收一半）。
   *   用途：避免**相邻共面 cuboid 边缘相接**产生重合接触点（接触层抖动的
   *   主要来源）。详见 `blk()` 里的注释。
   *   不选“合并块”是因为分块载荷是脚发力不均匀的唯一测量来源。
   */
  soleBlockGap?: number;
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
  /**
   * ★ 总开关：是否拆出**弓刚体 + 内侧前足刚体**（灵性足 F2）。
   *   关掉 = 回退到单刚体脚掉。
   *   用途：消融实验。灵性足对站立 / 重心调整 / 弹性的影响只能靠它对照定。
   */
  flexibleArch?: boolean;
}

export const DEFAULT_CONFIG: SkeletonConfig = {
  height: 1.8,
  mass: 70,
  // ★ 2D 时代用 0.5 是为了在**同一个平面内**减少双腿互穿；3D 之后双腿分开在 Z 上，
  //   再并拢反而让两个大腿胶囊（半径 6.9cm、间距 10cm）重叠。取 1.0 = 素材原样的
  //   自然站姿宽度（大腿中心间距 ≈ 0.20m）。
  // ★★ 站距。**判据 = 支撑面位置**，不是"对齐 Perry 的 step width"。
  //
  // ⚠⚠ 曾经的量纲错误（已更正）：把本 rig 的**踝间距**去比 Perry 的
  //   **step width 0.075m** ⇒ 得出"4.4× 人类"的错误结论。两者不是同一个量：
  //   step width = **相邻两步落点的横向间距**；站距 = **站立时双脚间距**。
  //
  // ★ 正确的文献基准 —— **Winter 1998**（J Neurophysiology 80:1211）按
  //   **hip-to-hip 的百分比**给站距，扫了 **50% / 100% / 150%** 三档：
  //   "Sway amplitude **decreased** as stance width increased, and **Ke
  //   increased with stance width**"（sway ∝ Ke^−0.55）
  //   ⇒ **宽站距 = 更稳**（刚度更高），不是更不稳。
  //
  // ★ 身高换算（本 rig 身高 **1.80 m**）：
  //   · Perry step width 0.075 m = **4.2% 身高**
  //   · 真实髋间距（biiliac）≈ 0.28 m = **15.6% 身高**
  //   · 真实站立踝间距 ≈ 0.10~0.15 m = 髋间距的 **35~55%**
  //   本 rig 髋间距 **0.25 m**（≈人类 0.28 m ✓）⇒ 站距 0.10~0.15 m 即
  //   `stance ≈ 0.25~0.40`。**本 rig 原来的 `stance=1.0`（站距 0.347m =
  //   髋的 139%）落在 Winter 实测区间内，并不离谱**，只是支撑面太靠外、
  //   重心爬不进去。
  //
  // ★★ 站距影响重心转移的**真实机制**（不是"稳不稳"，而是"进不进得去"）：
  //   重心不必到脚心，只需进入**脚掌横向范围**（真实足宽≈100mm，半 50mm）：
  //     stance=0.35 → 脚心 ±78mm ⇒ 支撑面 z∈[28,128]mm，重心到 **28mm** 即进入
  //     stance=1.00 → 脚心 ±163mm ⇒ 支撑面 z∈[113,213]mm，重心要爬到 **113mm**
  //   而 `handoverTolZ=50mm` 要重心到脚心 50mm 内 ⇒ 两者难度天差地别。
  //   实测（`tools/probe-stance.ts`）：0.00s(347mm) / 0.23s(226mm) /
  //   0.00s(162mm) / 0.52s(101mm) / 0.58s(29mm)。
  // ⚠ 下限受**脚宽**约束：脚掌半宽 ≈75mm ⇒ 踝距 <150mm 时两脚互相穿模。
  //   所以 **0.35（踝距 156mm、两脚刚好相切 = 髋的 65%）是物理下限**。
// ★★ 2026-10-05 用户决定：**回到 stance = 1.0**（原值）。
//   理由：0.35 的站距**观感不成立** —— 这是要放进游戏里的 boss 角色，
//   两脚几乎相切看起来不像人形。⇒ 站距是**角色设计参数**，
//   不是可以为了指标牺牲的自由量。
//   ⚠ 回退曾**静默失败**（编辑的字符串没匹配上，而脚本无条件打印 'ok'）。
//     `tools/probe-readback.ts` 就是为此写的：任何配置改动后必须回读实际数值。
//   代价（已知并接受）：`stance=1.00` 时重心进入支撑面需横移 **117mm**
//   （`stance=0.35` 只要 28mm），X3 驻留回到 0.00s。
//   ⇒ 重心转移必须从**别的方向**解决（伺服/迈步的平衡、相位时长对齐、
//     髋外展权限、脚宽），**不再靠缩站距**。
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
  // 裁剪线上移到踝锚点以上 123mm ⇒ 脚掌板高约 202mm（原 101mm 的两倍）
  footCropUpMm: 0.123,
  footCropOverlapMm: 0.01,
  // 冗余：绝对 10mm 与"脚掌高度的 10%"取大者 ⇒ 脚加高时自动跟着长
  footCropOverlapFrac: 0.1,
  soleGroundCorr: 0,
  soleSplit: true,
  // ★★ 脚掌外八 25°（用户定调："脚要向外侧倾斜，做成外八"，随后"再向外一点"）。
  //   脚掌盒的**横向位置**仍按膝锚点摆（膝到脚尖铅垂），外八只改脚尖的朝向。
  footSplayDeg: 25,
  // 踝：低头 25°（蹬地/尖脚）… 勾脚 20°（脚跟先着地）。保守取值，避免刚体互穿。
  anklePitchDeg: [0, 0],
  ankleRollDeg: 0,
  // ★★ 踝力矩上限（N·m）。原来 45 —— **解剖学上错了近 3 倍**。
  //   文献：踝跖屈（比目鱼肌+腓肠肌）是人体最大的肌群，年轻人最大自主收缩
  //   ~110~140 N·m（Noble & Norkowitz；Winter 1990 的踝策略力矩同量级）。
  //   45 经 TORQUE_AXIS_FACTOR 后三轴只有 27/15.8/45 N·m ⇒
  //     · 蹬离做不出来（实测 PUSH 相膝已 150/150 打满而踝只有 27）
  //     · CoP 可偏移仅 τ/F_z = 27/687 = **39mm**，做不了额状面主通道
  //   120 ⇒ 外展轴 72 N·m ⇒ CoP 偏移 72/687 = **105mm** ≈ 脚半宽 100mm
  //   （正好把 CoP 驱到足缘 —— van Mierlo 2022/2024：CMP 出支撑面是合法的）
  ankleTorque: Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).ANKTAU ?? 120),
  /**
   * ★ 髋**外展轴**的 τmax = `JOINT_MAX_TORQUE.hip × hipAbdTorqueFactor`。
   *   1.00 = 与屈伸轴同量级（200 N·m）；0.60 = 原值（120）。
   *   可扫，因为放开权限后实测**反而更差**（15 档刚度/阻尼组合全部驻留 0.00s，
   *   而 τmax=120 时同一律能到驻留 0.42s / 最小 X3 = 2mm）⇒ 髋外展权限
   *   **不是瓶颈**，多给会让它冲过目标。Inman 的 112 N·m 静态需求在 120 时
   *   已占 93%，实测那个余量恰好够用。
   */
  hipAbdTorqueFactor: 0.60,   // ★ 0.78 实测：τmax 派生所有默认刚度（kp=τmax/lim 系）→ 全局变硬 30%、A 相不收敛——
  //    "放开权限反而更差"的根因是**增益随 τmax 联动**；增强支撑发力必须连派生增益一起重标（见动作层文档 §5-17）
  // 弓关节限位（deg）：[旋后, 旋前]。上限 16 刻意小于"踩实"所需的 ~28（见下方注释）
  archLimitDeg: [-4, 16],
  /** 弓关节锚点沿足长的位置（0=足跟端, 1=脚尖端）。默认 0.22 = 弓的近端 */
  archAtFrac: 0.22,
  archRise: 0.000,   // ★ 实测定的（不是人体解剖值 20~25mm）
  // ★★ **默认 0（不留缝）** —— 实测空缝并未压掉 60Hz 周期-2 振动：
  //   gap=1.5/4/10mm 得到的去趋势帧间是 24.5 / 9.1 / 18.4mm（无单调趋势，是噪声），
  //   主周期恒为 2 帧。⇒ 共面接缝不是振动来源，默认开启只会无意义地改动质量分布。
  //   开关保留着，等找到真正的接触层解法后再调。
  soleBlockGap: 0,
  // ★ 踝屈伸**机械硬限位**（背屈 −12°/ 跖屈 +18°）。比素材 limitDeg 略紧，
  //   模拟距骨滑车的几何锁定（mortise wedging），防踝被力矩甩出去导致崴脚。
  ankleLimitDeg: [-28, 30],   // ★ 原 [-12,18]（防崴脚的紧限位）挡住了背屈=趾抬不起来！人体背屈 ~20°/跖屈 ~40°
  // ★ 中足关节位置（足长相对）：0.5 = 几何中心（两段等长、力臂对称）
  forefootAtFrac: 0.5,
  // ★ 中足（距下关节）旋前/旋后行程 ±12°（人体被动 ROM 是内翻 35°/外翻 14°）
  // ★ 中足（距下关节）旋前/旋后行程。
  //   ⚠ 2026-10-04 实测：**12° 不够**。要让内侧缘**离地**（从而卸载内侧柱、
  //   把载荷转到外侧柱），必须 `tanθ > 足厚/足宽 = 52/100` ⇒ **θ > 27.5°**；
  //   12° 只能把内侧缘抬 5mm，对着 26mm 的半厚根本脱离不了接触。
  //   实测佐证：刚度从 30 扫到 2000 N·m/rad，CoP_z 幅度恒为 18~19mm（全是单柱受力），
  //   随刚度零变化 ⇒ 柔性**没参与**。
  //   取 **±34°**（解剖学距下关节内翻 ~35°，见 `JOINT_LIMITS_XY_DEG` 踝条目注释）。
  midfootPronDeg: 34,
  footUvWarpDeg: 0,
  // ★ 踝**常开**（用户 2026-10-04：「脚踝是要一直开的，脚踝是肯定有用的，
  //   脚需要转向」）。之前这里是 false，导致只有 web 端（lab.ts 的
  //   DEFAULT_LAB.ankle = true）有踝，所有探针/默认配置都建成 12 关节无踝骨架。
  //   ⚠ 踝提供的是**转向**（roll/pitch/twist 三轴）+ 足底 CoP 权限；
  //     额状面平衡的主动力仍在髋（Winter 1995 [H]：并立站位 M/L 归髋不归踝）。
  ankleEnabled: true,
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
  // ★★ 查不到就返回 -1，**不再回退到 JOINT_ORDER**。
  //
  //   旧写法 `return JOINT_ORDER.indexOf(name)` 是个**静默指错关节**的陷阱：
  //   `JOINT_ORDER` 是硬编码常量，含 `foot_l`/`foot_r`（索引 9/10），
  //   但 `ankleEnabled=false` 时骨架里**根本没有踝关节**，
  //   真实 `sk.joints` 只有 12 个 ⇒ 索引 9/10 实际是 **`spine1`/`spine2`**。
  //   ⇒ 任何 `jointIndexByName(sk,'foot_l')` 都会拿到 spine1，
  //     指令下到腰上，而代码/探针都以为是踝。已实测踩到：
  //     "踝 CoP 权限"那一组数（a_x/a_理论≈1.2~1.7）其实是 spine1 屈伸的权限；
  //     "踝 CoP 反馈站满 20s"其实是 spine1 的 0.2° 指令。
  //
  //   与 `JOINT_ORDER.indexOf` 对脊柱的坑是同一个病（见 teacher.setAxis 的注释），
  //   只不过脊柱那次是 -1（静默不驱动），这次是**指错**（更坏：看起来在工作）。
  return -1;
}

/** 该关节在**这个骨架**里是否真的存在（UI/探针据此说明"没有踝"，而不是默默下错地方） */
export function hasJoint(sk: Skeleton, name: string): boolean {
  return sk.joints.some((j) => j.name === name);
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
  // ★ 额状面力矩预算（文献数字，记在这里备用；**暂时保持 200**，见下）：
  //     Inman 1947：单腿站立理论最小髋外展力矩 = 体重 × 半髋间距
  //                  = 687 N × 0.163 m = **112 N·m**
  //     hip=200 × TORQUE_AXIS_FACTOR[0]=0.60 ⇒ 外展轴 **120 N·m** ⇒ 占用 **93%**
  //     （文献实测：健康青年男 ~50%、健康老年女 ~82%）
  //   2026-10-04 实测把 hip 提到 250（外展 150 N·m、占用 75%）与
  //   SPINE_TAU 提到 180（侧屈 108 N·m，依据「腰椎侧屈半程 ⇒ 髋外展需求 −37%」）：
  //     侧向权限没变好、单支撑仍然 0.00s，**存活反而从 2.37s 掉到 1.97s**。
  //   ⇒ 原因不是额度不够，而是**矢状面就没稳住**（探针 E5：躯干倾角从 t=0.2s 起
  //     就在 8~27° 振荡，t=1.4s 踝角打到 +15°、t=1.8s τ踝 饱和 −120 N·m、CoM.x 跑到 +143mm）。
  //   ⇒ 先修矢状面，额度问题再谈；这里**回退到实测更稳的 200**。
  hip_l: Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).HIPT ??
    ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).HIPTAU ?? 200),
  hip_r: Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).HIPT ??
    ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).HIPTAU ?? 200),
  knee_l: Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).KNEETAU ?? 150),
  knee_r: Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).KNEETAU ?? 150),
  // ★ 踝：比膝小一个量级（踝在人类身上本来就只有膝的 1/5~1/4 力矩），
  //   45 N·m 足够做"勾脚/尖脚"，太大反而会让脚像弹簧一样抽。
  // ⚠ 这两个值**实际不生效**：踝走 `cfg.ankleTorque`（`skeleton.ts:1537` 的
  //   `/^(foot|ankle)_/` 分支），当前默认 **120** N·m —— 因为 45 实测太小。
  //   （原注释写"会被 cfg.ankleMaxTorque 覆盖"，但**那个配置项不存在**，
  //     曾据此误判"踝拿到的是脊柱的 120、是个 bug"。真名是 `ankleTorque`。）
  foot_l: 45,
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
  // ★★★★★ 2026-10-06 **脊柱补进表**（用户：「**一般人的脊柱也没这么大自由度啊，
  //   什么人能脊柱转圈啊**」）：
  //   此前这三根**不在表里** ⇒ 走的是兜底 `?? [20, 20]` —— **没有任何解剖依据**。
  //   实测（`probe-yaw` 全开）`spine1/1` 扭转冲到 **−116°**（"脊柱转圈"的物理画面）。
  //
  //   人体腰椎的**轴转（Y）是全脊柱最小的自由度**：
  //     · White & Panjabi《Clinical Biomechanics of the Spine》：腰椎每节轴转 ~2°
  //       （小关节面朝向把旋转锁死；全腰椎合计 ~10~13°）；
  //     · 侧屈（X）~20~30° 合计 ⇒ 每节 ~8~10°；
  //     · 屈伸是主自由度（±25°/节，本 rig 的 `/2` 轴已有）。
  //   ⇒ 取 **X=±12°、Y=±6°/节**（三节合计轴转 36°，仍偏宽松但已是解剖量级，
  //     且比兜底的 20° 收紧 3.3 倍）。
  //   ⚠ 与 §22.38 的"膝锁死反而崩"不同：脊柱的**侧屈/屈伸仍保留**，
  //     只收**轴转**这一个解剖上本就最小的自由度。
  spine1:     [12,  6],
  spine2:     [12,  6],
  spine3:     [12,  6],
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
   * ★ **前后**偏移（本地米，+X 前）。脚掌拆成"脚跟 + 前脚掌"两个碰撞体时必需：
   *   载荷在两者之间连续转移 ⇒ CoP 能在足长范围内连续调节，
   *   **不必把脚翻到边缘**（刚性单块脚掌只有"翻起来"才能移动接触形心，
   *   实测滚转 ±14° 全程 CoP 只动 4mm）。
   */
  offsetX?: number;
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
  /**
   * ★ 贴图的**子区域**（UV 归一化，`x/y` 左下原点，THREE 的 uv 约定）。
   *
   * 用途：脚掌要独立随踝转动，就必须从小腿那张贴图里**裁出靴子那块**
   * （用户 2026-10-04：「把小腿的脚裁剪出来附着在脚上」）。
   * 没有它只有两个选择：都不画（脚在踝转动时**消失**）或都画（**两只脚**）。
   *
   * ⚠ 只裁**纵向**（沿贴图高度切一刀），横向取整张 —— 靴子宽度与小腿等宽。
   *   `y` 是子区域下沿，`height` 是其高度，三者都用 0..1 归一化。
   */
  plateUv?: { x: number; y: number; width: number; height: number };
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
   * ★ 若非 `undefined`，该关节用 **revolute（铰链）** 建造，值是**自由转轴**
   * 在**父刚体局部系**里的方向。这是 Rapier 唯一支持**引擎级角度限位**的关节类型
   * （`JointData.revolute` + `limitsEnabled` + `limits = [min, max]`）。
   *
   *   **为什么踝必须是 revolute（2026-10-04，用户：「脚踝关节实现的有问题，
   *   为啥没有紧密连接脚和小腿呢，为啥其他关节正常」）**
   *
   *   此前**所有**关节都用 `JointData.spherical`（球铰，3 旋转全放），
   *   且代码里那两行 `limitsEnabled/limits` 被标注为**实测无效**：
   *     「Rapier 0.14 不吃这个格式 —— 打开前后所有回读逐位相同」
   *   查证：`ImpulseJoint.limitsMin()/limitsMax()` 是**单对标量**
   *   （给 revolute/prismatic 设计的），球铰没有三轴限位 API
   *   ⇒ **整个骨架一个物理限位都没有**，角度全靠 `enforceLimits()` 的手写冲量。
   *
   *   为什么只有踝暴露：
   *     · 踝要驱动 CoP ⇒ 马达 `τmax = 120 N·m`（小腿才 72）
   *     · 踝屈伸行程只有 **30°**（`ankleLimitDeg = [−12°, 18°]`），最容易撞限
   *     · 脚掌刚体轻 ⇒ 角度一失控整只脚就甩出去
   *   其他关节行程宽、力矩小，速度级冲量**恰好**够用 ⇒ 看起来"正常"。
   *
   *   实测（未改前）：踝屈伸轴跑到 **±174°**、越限 20~30%
   *   ⇒ 脚在前视图里侧翻 40~90°（用户亲手画的框证实）⇒ 支撑面朝向失控，
   *     平衡系统无从下手 ⇒ 这是站不住的根本原因。
   *
   *   改后：踝拿到**引擎级**限位，物理上不可能侧翻，不依赖手写冲量。
   *   代价：内翻/扭转（轴 0/1）被铰死 —— 但那正是解剖学上踝在正常步态里的
   *   绝大部分行为（踝只做背屈/跖屈）。
   */
  revoluteAxis?: Vec3;
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
/**
 * ★★ 每关节的**轴数** = 3。
 *
 * 这是全 rig 的**轴步长约定**：所有按 (关节, 轴) 寻址的扁平数组都用
 * `joint * AXES_PER_JOINT + axis`。此前这个 3 在几十处写成魔数，改轴数就得全改。
 *
 * 它同时是**神经网络每关节的输出数**（`brain.ts` 的 `OUTPUT_PER_JOINT`）——
 * 两者是同一个约定，所以只有这一处定义。
 *
 * ⚠ 三轴的**物理含义**见 `JOINT_AXIS_SEMANTICS` 附近的注释：
 *   0 = 绕 X = 外展/侧摆、1 = 绕 Y = 扭转、2 = 绕 Z = 屈伸。
 *   写错索引会让控制器作用在**解剖上错误的肌肉**上且毫无症状
 *   （曾把髋外展通道写在 axis 1 = 扭转轴，力臂差 10 倍而 τ 只有 0.9 N·m）。
 */
export const AXES_PER_JOINT = 3;

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
  // ★★ 足长按**文献人体测量**定，不再直接用素材的 `META.sole.len`
  //   （2026-10-04，用户：「按照文献，设定合适的脚的大小」）。
  //   依据：足长/身高 人类 **14.3~16.1%**（Topinard 1877 / Martin 1914，经
  //   Giles & Vallandigham 1991 美国陆军 6682 男+1330 女验证：男 15.35%、女 14.93%；
  //   香港激光扫描队列独立复核 14.94~15.13%）⇒ 取中值 **15.6%**。
  //   身高 1.8 m ⇒ 足长 **0.281 m**（素材给的 0.214 m 只有身高的 11.9%，
  //   低于整个人类区间下限，矢状 CoP 权限先天打折）。
  //   交叉校验：Millard & Sloot 2025 [H] 实测人类真正使用的支撑面 fBOS 只有
  //   脚的 **49% 长 / 43% 宽**；0.281 m 的脚 ⇒ fBOS 长约 0.138 m，与他们测到的
  //   14.8 cm 对得上；0.214 m 的脚只剩 0.105 m。
  const soleLenTarget = 0.156 * cfg.height;      // 米
  const soleHalfLen = soleLenTarget / 2;
  const soleHalfThick = (META.sole.thick * px2m) / 2;
  /** ★ 足的目标**全宽**（米）。人类参考脚 30 cm × 10 cm（Millard & Sloot 2025）⇒ 0.10 m */
  const SOLE_WIDTH_TARGET = 0.10;
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

  // ══════════════════════════════════════════════════════════════
  // ★ 柔性足 F2（2026-10-05）：**弓刚体 + 旋前关节**
  // ══════════════════════════════════════════════════════════════
  //  动机（实测，见 tools/probe-footroll.ts）：脚原本是**单个刚体**，内侧弓被
  //  硬编码离地 22mm 之后**永远不可能接地** ⇒ 承重退化成「足跟 + 外侧缘」
  //  一条线、跖骨/趾 ≈ 0% ⇒ 侧向 CoP 无处可去 ⇒ 侧翻。
  //  文献：Jeon & Cho 压力垫综述「第一接触点通常在踝关节中心**外侧**，在
  //  **距下关节产生旋前力矩**」「**内侧弓把重量传递到足的外侧缘**」；
  //  Welte 2023：内侧弓的**可动性**是人类两足行走的演化产物。
  //
  //  ⚠ 拓扑改动**必须两段式**（这是上一轮失败的确切原因）：
  //     `bodies` 在 line ~1022 声明，而 **`joints` 在 line ~1528 才声明**
  //     ⇒ 关节**不能**在 bodies 循环里 push（编译不过）。
  //     所以：① 循环内只造**弓刚体**，把造关节需要的量存进 `ARCH_SPEC`；
  //          ② `joints` 声明之后再统一建关节（照抄脊柱那段的形式）。
  interface ArchSpec {
    side: 'l' | 'r';
    footKey: string;      // 父刚体（foot_l / foot_r）
    archKey: string;      // 子刚体（arch_l / arch_r）
    /** 关节锚点**世界**坐标（足长 archAtFrac 处、弓的抬升高度上） */
    wx: number; wy: number; wz: number;
    /** 弓块占鞋底总质量的比例（按体积算，见循环内） */
    massFrac: number;
    /**
     * ★ 内侧前足（`mfoot_*`）的位置与关节锚点。
     * 链路：`foot` → `arch` → `mfoot`（见循环内的拆分说明）。
     * `mfoot` 的锚点在**弓的远侧端**（fx = +0.145）且同样在旋前轴（鞋底外侧接地棱）上。
     */
    mfootKey: string;
    /** mfoot 的连接锚点世界坐标 */
    mwx: number; mwy: number; mwz: number;
  }
  const ARCH_SPEC: ArchSpec[] = [];
  /** IIFE（`colliders`）向外传值用的出口。IIFE 内拿不到外层的 `arch_*`，
   *  外层又需要 IIFE 才算出的量 ⇒ 用这个对象当中转站。 */
  interface ArchOut {
    archBlocks: ColliderDef[];
    archRise: number; archCx: number; archCz: number; archMass: number;
  /** 弓的调试包围盒（不得继承小腿尺寸，否则调试视图在脚部画出小腿那么长的胶囊） */
  archDims: { len: number; rad: number; hh: number };
  /** 内侧前足（第一跳骨头）的块 / 质量 / 位置 */
    mfootBlocks: ColliderDef[];
  mfootMass: number;
  mfootCx: number;
  }
  const ARCH_OUT: ArchOut = {
    archBlocks: [], archRise: 0, archCx: 0, archCz: 0, archMass: 0,
    archDims: { len: 0.081, rad: 0.007, hh: 0.010 },
    mfootBlocks: [], mfootMass: 0, mfootCx: 0,
  };
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
    // ★★★★★ 2026-10-06 **中线归零**（用户「回读前 0.1s」暴露的 +2.85mm 真身）：
    //   `probe-init` 实测：四肢镜像对称（±0.164/±0.224/±0.341），而**中线不对称**——
    //   躯干/脊柱 **z=+7mm**、头 **z=−6mm**（源画布 `cx` 画偏 ±6~7mm 经 `mapZ` 映射而来）
    //   ⇒ **CoM 第 0 拍就 +2.85mm** ⇒ 侧翻的**物理种子**（与控制无关）。
    //   ⇒ 中线部件（head/neck/torso）的世界 z **强制归零**。
    //   `CENTERC=0` 可关（A/B）。
    // ⚠⚠ **实测：强制归零更差**（CoM.z +2.85→**+3.35mm**、真倒 8.47→5.62s）——
    //   说明脊柱分段的位置**不是**从 `torso.centerZ` 派生的（注入层选错），
    //   且**又是"改掉歪斜反而更差"**（本会话第 5 次同规律）。
    //   ⇒ 默认**关**；发现（源画布中线画偏 ±6~7mm）保留在 §22.55。
    const CENTER_C = !['0', 'false', 'off'].includes(String(
      ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).CENTERC ?? '').trim().toLowerCase());
    if (CENTER_C && (spec.key === 'head' || spec.key === 'neck' || spec.key === 'torso')) {
      centerZ = 0;
    }
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
        // ★★ 2026-10-04：中心要再往下挪一个 `legStretch`。
        //   关节锚点 `wy = mapY(ayPx) − stretch`（见 JOINT_ORDER 循环），
        //   而这里原本用**未拉伸**的膝/踝中点做中心 ⇒ 踝锚点比胶囊末端低
        //   `stretch = 20 mm`，而 `PIVOT_PAD` 只有 15 mm ⇒ 差 5 mm，
        //   门禁报 `foot_l.P 局部(0,−208,0) 超出 shin_l 包围球 5.0mm`。
        //   两个锚点被**同样**下移，彼此间距不变 ⇒ 胶囊长度不用改，只挪中心。
        centerY = (mapY(kn[1]) + mapY(ak[1])) / 2 - cfg.legStretch;
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
    // ★ 小腿板的裁剪窗口（踝以上那半）。声明在踝分支**之外**，
    //   因为小腿刚体是在分支之后才 push 的，而两块必须共用同一个 `footFrac`
    //   才拼得回原图（用户 2026-10-04：「小腿和脚掌的纹理是独立的，
    //   只是从相同的纹理上裁剪罢了」）。
    let shinPlateUv: { x: number; y: number; width: number; height: number } | undefined;
    if (solePct > 0) {
      const soleMass = (solePct / 100) * cfg.mass;
      const sfx = Math.max(0.1, cfg.soleFootScale);
      const side = spec.key === 'shin_l' ? 'l' : 'r';
      const paw = LIMB_AXES.paw?.[side];
      const knee = LIMB_AXES.anchors?.[spec.key === 'shin_l' ? 'knee_l' : 'knee_r'];
      const anklePx = LIMB_AXES.anchors?.[spec.key === 'shin_l' ? 'foot_l' : 'foot_r'];
      // ★★★ 把脚绕竖轴**转 90°**（用户 2026-10-04：「脚和纹理都要转90度，
      //   把长边的方向定义为真正的脚的方向」）。
      //
      //   原来：`hx = soleHalfLen`（前后半长 109mm）、`hz = 实测靴半宽`（102mm）
      //     ⇒ 每个脚盒 70 × 204 × 52，**长边 204mm 落在横向 Z 上**
      //     ⇒ 脚的方向看起来是横着/朝后的（骨架线框里一眼可见）。
      //   转 90° 后：**长边必须落在前后向 X 上**，也就是把两个半轴对调 ——
      //     · 前后半长 `hx` ← 原来的靴宽半值（102mm ⇒ 前后 204mm，占满整个脚长）
      //     · 横向半宽 `hz` ← 原来的前后半值（109mm ⇒ 横向 218mm）
      //   ⚠ 对调后**横向会变宽**（218mm），前后 204mm，长/宽 = 0.94 < 1 ⇒ 长边又跑到横向去了。
      //     所以对调之后必须再把横向收到前后以内，取人脚 长/宽 ≈ 2.4 ⇒ `hz = hx × 0.42`。
      //   最终：前后 204mm × 横向 86mm，**长边 = 前后向 = 脚的方向** ✓
      const hxRaw = soleHalfLen * sfx;                                  // 前后半长（109mm）
      const hzRaw = (paw ? paw.lateralHalf * px2m : radius * 0.9) * sfx; // 实测靴半宽（102mm）
      // ★★★ 长边 = 脚的方向，必须落在**前后向 X**（用户 2026-10-04：
      //   「把长边的方向定义为真正的脚的方向」「我要之前那样的长方形」）。
      //
      //   原来每个脚盒 = 前后 70mm × 横向 204mm ⇒ 长边在横向，脚的方向是横的。
      //   坑：把 `hx` 放大后如果沿用 `hxBall = hx×0.32`，每盒前后只剩 70mm、
      //   横向 92mm ⇒ **变成正方形**（用户 2026-10-04：「脚骨架成了正方形了」）。
      //   所以要同时做两件事：
      //     ① 两半改成 `0.5·hx @ ±0.5·hx`（在 x=0 相接，各占一半，不再留中间空隙）
      //     ② 横向收到 `hx × 0.30`，让每盒 前后 109 × 横向 65 ⇒ 长/宽 1.67
      //   ⚠ 横向从实测靴宽 204mm 收到 65mm：collider 比画出来的靴子窄很多。
      //     这是"骨架是长方形 + 长边=脚方向"的必然代价（线框视图可见）。
      const hx = hxRaw;
      //   ★ 横向半宽按**人类参考脚宽 10 cm**取半 ⇒ `hz = 0.05 m`。
      //   原来是 `hx × 0.30`（我为修"脚变正方形"自己拍的系数），把盒子压到
      //   66 mm 宽、长宽比只剩 2.4（人类参考脚 30/10 = 3.0）
      //   ⇒ 额状 CoP 权限不足，踝扛不住 mg×站距半宽 ⇒ 表现为「崴脚」。
      const hz = (SOLE_WIDTH_TARGET / 2) * sfx;
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
        // ★★★ 脚掌贴图的**裁剪区域**（UV 归一化）—— 从小腿那张里切出靴子。
        //   ⚠⚠ 裁剪线必须在**贴图局部坐标**里算，不能直接用画布坐标：
        //   `anklePx` 是**画布 px**（踝在 y≈2792），而这张贴图只有 `part.h` ≈ 408 px 高
        //   （它只是画布裁出来的一块）⇒ 直接除会得到 y = −6.7 这种越界值。
        //   正确做法：先减去贴图自身的左上角 (`part.cx − part.bw/2`, `part.cy − part.bh/2`)。
        // ★★★ 小腿贴图沿高度**按踝锚点切成两块**（用户 2026-10-04：
      //   「小腿和脚掌的纹理是独立的，只是从相同的纹理上裁剪罢了」
      //   「脚是很小的底部一小块，你需要去除掉小腿的脚，然后使用裁剪下来的脚」）。
      //
      //   两块**各自独立成板**（各自的 mesh / 尺寸 / 位置），只是都从**同一张**
      //   小腿贴图取不同的 UV 窗口：
      //     · 小腿板 = 踝**以上**   uv.y = footFrac, height = 1 − footFrac
      //     · 脚掌板 = 踝**以下**   uv.y = 0,         height = footFrac
      //   合起来正好是原贴图 ⇒ **无缝**，且画面上只有一只脚。
      //
      //   ⚠⚠ 归一化分母用 **`part.bh`（内容框高，画布 px）**，不是 `part.h`：
      //   `part.h` 是降采样后的贴图像素高（408）、`part.bh` 是内容框（817），
      //   而 `anklePx` / `part.cy` 全是画布 px ⇒ 必须同量纲，否则差 1/scale = 2 倍。
      const plateH = part.bh * px2m;          // 该贴图内容框的世界高度（米）
      // ① 切线：以踝锚点为基准**上移** `footCropUpMm`
      //    （画布 y 向下，所以"上移" = 锚点 y 减小）
      const cutFrac = (() => {
        const texTopPx = part.cy - part.bh / 2;      // 内容框上沿（画布 y）
        const cutPx = anklePx[1] - cfg.footCropUpMm / px2m;
        return Math.min(0.95, Math.max(0.02, 1 - (cutPx - texTopPx) / part.bh));
      })();
      // ② 冗余：切线两侧各让出这么多 ⇒ 两块重叠 2×。
      //    「绝对毫米」与「脚掌高度的比例」取**较大者** —— 踝线抬高、脚掌板变高时，
      //    固定毫米在比例上会变薄，靠比例项把它拉回来。
      const slack = Math.min(
        0.25,
        Math.max(cfg.footCropOverlapMm / plateH, cfg.footCropOverlapFrac * cutFrac),
      );
      const footUv = { x: 0, y: 0, width: 1, height: Math.min(1, cutFrac + slack) };
      // ★ 小腿那半：下沿**也**越过切线 `slack`（冗余），于是两板重叠而非硬对接
      const shinY = Math.max(0, cutFrac - slack);
      shinPlateUv = { x: 0, y: shinY, width: 1, height: 1 - shinY };
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
        // ⚠⚠ **外八会把脚掌盒转进地面 —— 这就是"踝一开就塌"的直接原因。**
        //   局部几何算的是：碰撞体在 body-local 的 y 跨度恰为 `[0, 2·soleHalfThick]`
        //   （所以 `SOLE_GROUND_CORR = 0` 在**不旋转**时是精确的）。
        //   但脚掌刚体带 `restYawRad = footSplayDeg(25°)`，而碰撞体定义里
        //   **没有旋转字段**（`{hx, hy, hz, offsetY, offsetZ}`），无法反向补偿 ——
        //   于是长方体绕 Y 转了 25°，最低角比设计值低 `hx·|sin 25°|`。
        //   实测：`ankleEnabled=true` 静止时 `soleY = −0.0172 m`（脚底在地面下 17mm），
        //   接触约束被预压 ⇒ 零输出 3.25 s 必倒（躯干 y 1.429→0.538、倾角 69°、crash）。
        //   ⇒ 把刚体整体降下来，让**最低角**正好落在 y=0。
        //   真正的修法是给碰撞体加旋转字段（足底保持世界水平、只有朝向外八），
        //   那需要改 `ColliderDef`；此处先用高度修正，效果等价且不动结构。
        // ⚠ 系数是**实测标定**的，不是推算值：`Ragdoll.footPoint()` 取的并不是
        //   长方体的几何最低角（按 hx·|sin yaw| 全额下沉会**过冲**：
        //   实测 soleY 从 −17.2mm 变成 +23.0mm）。扫这个系数使静止 soleY = 0。
        const yawDip = cfg.soleGroundCorr;
        const local = rotVecByQuat(fQInv, [0, fMidY - ankleY - SOLE_GROUND_CORR - yawDip, 0]);
        // ── 柔性足 F1（2026-10-04）：中足关节在足长上的位置（足局部 X）──
        //   `forefootAtFrac`：0 = 足跟端，1 = 脚尖端；0.5 ⇒ 几何中心（两段等长）
        const midX = (cfg.soleFootScale * hx) * (cfg.forefootAtFrac * 2 - 1);
        // ── 脚掌 collider 的前后/柱分配（原先在 IIFE 里，柔性足需要在外面复用）──
        const two = cfg.soleSplit;
        const hxBall = two ? hx * 0.50 : hx;
        const offBall = two ? hx * 0.50 : 0;
        const hzCol = hz * 0.5;
        const offColIn = +(hz * 0.5).toFixed(6);   // 内侧柱中心
        const offColOut = -(hz * 0.5).toFixed(6);  // 外侧柱中心
        bodies.push({
          key: spec.key === 'shin_l' ? 'foot_l' : 'foot_r',
          bone: spec.bone,
          label: spec.key === 'shin_l' ? '左脚掌' : '右脚掌',
          part,                       // 贴图仍借小腿那张（下面裁出靴子那块）
          cx: 0,
          cy: ankleY,
          // ★ 对齐（用户 2026-10-04：「让脚部关节对称轴对着小腿的对称轴」）：
          //   脚掌刚体的横坐标必须用**小腿的对称轴 `centerZ`**，而不是素材实测的
          //   `ankleZ = mapZ(anklePx[0])` —— 后者带着"外八"的横向偏移（膝到踝不是铅垂），
          //   于是踝关节落在小腿中线之外，脚看着是歪的。
          //   偏航（外八）由 `restYawRad = restYawOf(...)` 单独表达，和位置无关。
          cz: centerZ,
          restTiltRad: fTilt,
          restYawRad: fYaw,
          // ★★★ 脚掌板：**从小腿贴图里裁出踝下方那块**（用户 2026-10-04：
          //   「把小腿的脚裁剪出来附着在脚上」）。
          //   裁剪边界用**实测的踝锚点**（`jointsMeta` 的 `foot_*`，画布 y=2792）
          //   与 `META.sole.len/thick`（素材实测）算，都不是猜的。
// ⚠ 归一化按**整张贴图**（`META.parts[key].h`），THREE 的 uv 原点在左下，
          //     而素材坐标原点在左上 ⇒ y 要翻转。
          //
          // ★ `plateOffset` 必须把脚掌刚体原点（= **踝**）换算到 viewer 裁剪公式
          //   所假设的基准（= **原贴图中心**），否则脚掌板会被推到地面以下
          //   （实测脚埋进地下）。画布 y 向下、世界 y 向上，故取负号：
          //     plateOffset.y = mapY(part.cy) − mapY(anklePx[1])
          //                 = (anklePx[1] − part.cy) × px2m
          plateOffset: [0, (anklePx[1] - part.cy) * px2m, 0],
          plateUv: footUv,
          length: soleDrop,
          radius: 0,
          halfHeight: soleDrop / 2,
          mass: soleMass,   // ★ 由下面的不变式后处理统一校准（见 assertColliderMass 上游）
          // ★★ 脚掌拆成「脚跟 + 前脚掌」两块碰撞体（用户 2026-10-04：「实在不行你自行对腿部纹理横向裁一刀」）。
          //   原因（实测）：单块刚性脚掌平放时，接触形心不会因倾转而移动 ——
          //   要让 CoP 移动只能把脚翻到边缘。而几何上正好卡在限位：
          //     半宽 hz=102mm，滚转 14° 使内侧缘抬9 hz·sin14°=25mm
          //     而脚半厚 hy=26mm → 刚好触边，实测 CoP 全程只动 4mm。
          //   拆成两块后，载荷可在两者之间**连续**转移
          //   ⇒ CoP 在足长范围内连续可调，不必翻脚。
          // ══════════════════════════════════════════════════════════════════
          // ★★★ 足骨架按**真实人脚形状**重建（2026-10-04）
          // ══════════════════════════════════════════════════════════════════
          //   之前是 **281×100×52mm 的等厚平板**（外八 25°）。两个致命问题：
          //     ① **内侧柱与外侧柱同时着地** ⇒ 载荷已在两柱上，接触求解器
          //        **没有可迁移的压力**。实测髋外展力矩 −120N→+120N 期间
          //        CoP_z 只动 **0.9mm**（内侧柱 175N : 外侧柱 12N = **14:1**）。
          //     ② 要卸载内侧柱得把 52mm 厚的板翘起来 ⇒ `tanθ > 52/100`
          //        ⇒ 需要 **>27.5°** 的中足行程，所需力矩超出前足质量能提供的量。
          //        实测：中足行程给到 55°、刚度 2000 N·m/rad，CoP_z 幅度恒为
          //        18~19mm 且随两者**零变化** ⇒ 柔性根本没参与。
          //
          //   **真实人脚不是平板** —— 关键在**内侧弓**：
          //     · Jeon & Cho 压力垫综述：「第一接触点通常在踝关节中心**外侧**，
          //       在**距下关节产生旋前力矩**，允许柔性活动」
          //       「**内侧弓把重量传递到足的外侧缘**」
          //     · Welte 2023：内侧弓的可动性是人类两足行走的演化产物
          //   ⇒ 仿人脚形状后**内侧弓天生离地** ⇒ 侧向 CoP 权限**白送**：
          //     给一点向外力，内侧柱本来就不承压，载荷立刻转到外侧缘。
          //   ⚠⚠⚠ **原注释此处写过一句错误的话**（2026-10-05 更正）：
          //   「弓本身就是拱形柔顺结构（承重压缩、离载回弹），**不需要额外的
          //   中足关节来模拟**」—— **这是假的**。拱形柔顺需要**形变能力**，
          //   而整只脚当时是**单个刚体**、形变能力为 0 ⇒ 内侧弓被硬编码离地
          //   22mm 之后**永远不可能接地**。实测（`tools/probe-footroll.ts`）：
          //   承重全在「足跟 + 外侧缘」，跖骨/趾 ≈ 0% ⇒ 支撑面退化成一条线
          //   ⇒ 侧向 CoP 无处可去 ⇒ 侧翻。
          //   ⇒ 真正的旋前自由度改由**弓刚体 + 弓关节**提供（见 archBlocks）。
          //
          //   比例（占足长百分比 / 绝对宽度 / 厚度），足长 = `2·L`：
          //     足跟  0–21%   宽 60mm   厚 26mm  全宽接地
          //     弓区 22–57%   外侧柱 30mm 厚 10mm 接地 · 内侧弓 30mm **离地 22mm**
          //     跖球 57–89%   宽 100mm（最宽）厚 20mm 全宽接地
          //     趾   89–100%  宽 76mm   厚 12mm  接地
          //   （100mm 宽 = `SOLE_WIDTH_TARGET`，符合 Millard 参考脚 30×10cm）
          // ══════════════════════════════════════════════════════════════════
          colliders: (() => {
            // ★ 提成配置项（原硬编码 0.022）—— 它决定「弓能不能真的承重」。
            //   实测（240Hz 站立）：脚的倾角只有 1.93°…7.45°，而弓区底面比鞋底高 22mm，
            //   所以弓 **480 帧一次都没碰到地面**（接触帧 0/480、弓角行程 0.03°）。
            //   几何：弓区在内侧（fz 0.40..1.00），承重窄条在外侧（fz ≈−63mm），
            //   两者间距 126mm ⇒ 要让弓落地需旋前 `sinθ = rise/126`。
            //   rise=22mm ⇒ θ≈10°，超过实测可达的旋前量。
            const archRise = cfg.archRise;
            interface Blk extends ColliderDef { _vol: number; _label: string }
            const L = cfg.soleFootScale * hx;
            const HW = (SOLE_WIDTH_TARGET / 2) * cfg.soleFootScale;
            const soleBottom = local[1] - soleHalfThick;

            /** 一块 collider：给 x0..x1 / z0..z1（相对半长半宽的比例）+ 厚度 + 离地抬升 */
            const blk = (fx0: number, fx1: number, fz0: number, fz1: number,
                         hyMm: number, rise: number, label: string): Blk => {
              const hy = (hyMm / 1000) * cfg.soleFootScale;
              // ★ 半轴 = **长度的一半**。`fx∈[-1,1] ↔ x∈[-L,+L]`，
              //   所以长度 = `(f1−f0)·L`，半长 `hx` 要再除以 2
              //   （漏掉 /2 会让足长变 336mm、最宽 200mm —— 实测踩到）
              // ★★ 块间留缝（解决 60Hz 周期-2 振动）。
              //   每块在计划视图（XZ 平面）上两边各收 1.5mm。
              //   原因：相邻块**共面且边缘相接**，在接缝处会生成重合接触点，
              //   是 Rapier 接触求解器抖动的典型来源。实测：每脚 6 个共面 cuboid
              //   → 周期恰好 2 个物理帧（60Hz，12~18mm）的竖向振动，且
              //   **马达全部验零后仍然存在** ⇒ 排除控制轮，定位到接触层。
              //   ★ 为什么不选“合并块”：分块载荷每块可读出来，那是“脚的
              //     不均匀发力”的**唯一可测量来源**（弓承重百分比就靠它）。
              //     合并会把刚拿到的东西丢掉。所以选留缝而不合并。
              //   缝只收计划视图，不动 y（`hy`/`rise` 不变）⇒ 底面仍在同一高度。
              const gap = (cfg.soleBlockGap ?? 0) / 2;
              const hxm = Math.max(1e-4, ((fx1 - fx0) * L) / 2 - gap);
              const hzm = Math.max(1e-4, ((fz1 - fz0) * HW) / 2 - gap);
              const cxm = ((fx0 + fx1) / 2) * L, czm = ((fz0 + fz1) / 2) * HW;
              const vol = 4 * hxm * hzm * hy;   // = (2hx)(2hz)(2hy)/2
              return {
                shape: 'cuboid', halfHeight: 0, radius: 0,
                hx: hxm, hy, hz: hzm,
                offsetX: cxm,
                offsetY: soleBottom + hy + rise,
                offsetZ: czm,
                mass: vol, comY: 0, inertiaZ: 0, inertiaXY: 0,
                _vol: vol, _label: label,
              };
            };
            // ── 六块。Z 为内侧（+Z）；左列=外侧（接地），右列=内侧弓（抬起）──
            const blocks: Blk[] = [
              blk(-1.00, -0.435, -0.60, 0.60, 26, 0, '足跟'),
              blk(-0.435, 0.145, -1.00, -0.40, 10, 0, '外侧柱'),
              blk(0.145, 0.785, -1.00, 0.00, 20, 0, '跖骨头·外侧'),
              blk(0.785, 1.00, -0.76, 0.76, 12, 0, '趾'),
            ];
            // ★★★ 内侧前足（第一跖骨头）归**新刚体 `mfoot_*`**，不进 `blocks`。
            //
            //   拆它的理由（用户 2026-10-05：「足弓可能不接地，但理论上也在承重」）：
            //     真实内侧柱是**串联**链：足跟→距骨→舟骨→楔骨→第一跖骨头→地面。
            //     足弓在这条链**上**，所以不接地也承重（像弓弦一样受拉）。
            //     原来的拆法是「脚掌全部 collider 直接落地 + 弓为死端悬臂」——
            //     实测弓关节力仅 **1N**（恰好弓自身重 0.123kg×9.81），踝关节力 10N
            //     ⇒ 弓一条载荷都不传，再怎么调重心侧移都没用。
            //   拆出后链路变成：
            //     foot(后足/外侧) → arch(内侧中足) → mfoot(内侧前足) → 地面
            const mfootBlocks: Blk[] = [
              blk(0.145, 0.785, 0.00, 1.00, 20, 0, '跖骨头·内侧'),
            ];
            // ⚠ 消融对照：`flexibleArch=false` 时必须把这块归回脚体，
            //   否则关掉灵性足时总质量会少 0.70kg（实测 69.30，应为 70.00）。
            if (cfg.flexibleArch === false) blocks.push(mfootBlocks[0]!);
            // ★★★ 弓刚体的两块（**已从 foot_* 上拆走**）：它们是唯一需要
            //   **相对足体运动**的部分 —— 旋前时向下踩实、承重后回弹。
            //   留在 foot_* 上就永远离地（见上面被更正的错误注释）。
            // ★ 弓的两块：它们归**弓刚体** `arch_*`，**不进 `blocks`**。
            //   （留在 foot_* 上就永远离地 —— 见上面被更正的那条错误注释。）
            const archBlocks: Blk[] = [
              blk(-0.435, -0.145, 0.40, 1.00, 20, archRise, '内侧弓·后'),
              blk(-0.145, 0.145, 0.40, 1.00, 20, archRise, '内侧弓·前'),
            ];
            // 弓的质量占比（按体积，鞋底总质量 soleMass 为单位）
            // ★ 三个“拆走的”部件（弓 / 内侧前足）按体积从 soleMass 里拆。
            // ⚠ 开关关掉时，弓的两块也必须归回脚体。
            //   否则它们的质量从鞋底里拆走了、又没归给任何刚体 ⇒ 丢掉它们的质量。
            if (cfg.flexibleArch === false) blocks.push(...archBlocks);
            const archVol = archBlocks.reduce((a, b) => a + b._vol, 0);
            const mfootVol = mfootBlocks.reduce((a, b) => a + b._vol, 0);
            const archVolAll = cfg.flexibleArch === false ? 0 : archVol;
            const mfootVolAll = cfg.flexibleArch === false ? 0 : mfootVol;
            const allVol = archVolAll + mfootVolAll + blocks.reduce((a, b) => a + b._vol, 0);
            const archMass = soleMass * (archVolAll / allVol);
            const mfootMass = soleMass * (mfootVolAll / allVol);
            for (const [grp, gm] of [[archBlocks, archMass], [mfootBlocks, mfootMass]] as const) {
              const gv = grp.reduce((a, b) => a + b._vol, 0);
              for (const b of grp) {
                b.mass = gm * (b._vol / gv);
                b.inertiaZ = (b.mass * (b.hx * b.hx + b.hy * b.hy)) / 3;
                b.inertiaXY = (b.mass * (b.hz * b.hz + b.hy * b.hy)) / 3;
              }
            }
            ARCH_OUT.mfootBlocks = mfootBlocks;
            ARCH_OUT.mfootMass = mfootMass;
            ARCH_OUT.mfootCx = 0.145 * L;   // 弓的远端（内侧前足与弓的连接靠这一点）
            ARCH_OUT.archBlocks = archBlocks;
            ARCH_OUT.archRise = archRise;
            ARCH_OUT.archCx = ((-0.435 + 0.145) / 2) * L;
            ARCH_OUT.archCz = ((0.40 + 1.00) / 2) * HW;
            ARCH_OUT.archMass = archMass;

            // ★ 弓的调试包围盒（从弓块实际偏移推，不写死）
            {
              const aLo = [Infinity, Infinity, Infinity];
              const aHi = [-Infinity, -Infinity, -Infinity];
              for (const c of archBlocks) {
                const o = [c.offsetX ?? 0, c.offsetY ?? 0, c.offsetZ ?? 0];
                const h = [c.hx, c.hy, c.hz];
                for (let a = 0; a < 3; a++) {
                  aLo[a] = Math.min(aLo[a]!, o[a]! - h[a]!);
                  aHi[a] = Math.max(aHi[a]!, o[a]! + h[a]!);
                }
              }
              ARCH_OUT.archDims = {
                len: aHi[0]! - aLo[0]!,
                rad: Math.max(aHi[1]! - aLo[1]!, aHi[2]! - aLo[2]!) / 4,
                hh: (aHi[1]! - aLo[1]!) / 2,
              };
            }

            // 体积 → 质量归一。
            // ⚠⚠ `blocks` **已不含弓的两块**（它们归弓刚体），所以这里的
            //   归一化基准必须是「脚体自己那份质量」= `soleMass − archMass`，
            //   否则脚体会拿到**整份** `soleMass`、弓体再拿一份 ⇒ 总质量多出
            //   `archMass`（实测 70.25kg，应为 70.00kg）。这不只是数字问题：
            //   整机 CoM 会跟着漂（实测 `com.z` 从 −9mm 变 −14mm、站距/髋间距
            //   从 1.35 变 1.03），此前所有标定过的常数全部要重量。
            // ★ 必须同时减掉**内侧前足**的邨分，不只减弓。
            //   只减弓时总质量 = 70.45kg（多 0.45kg，正好是内侧前足那一块）。
            const footMass = soleMass - ARCH_OUT.archMass - ARCH_OUT.mfootMass;
            const volTot = blocks.reduce((a, b) => a + b._vol, 0);
            for (const b of blocks) {
              const m = footMass * (b._vol / volTot);
              b.mass = m;
              b.inertiaZ = (m * (b.hx * b.hx + b.hy * b.hy)) / 3;
              b.inertiaXY = (m * (b.hz * b.hz + b.hy * b.hy)) / 3;
            }
            return blocks;
          })(),
          leg: true,
        });

        // ══════════════════════════════════════════════════════════════
        // ★ 柔性足 F2 第一段：**弓刚体**（`arch_l` / `arch_r`）
        // ══════════════════════════════════════════════════════════════
        //   · 位置：与 `foot_*` **同一个几何中心**（`cx/cy/cz` 全同）——
        //     这样 collider 的 `offsetX/Y/Z` 可以在两刚体间直接照搬，
        //     也保证绑定姿态下弓正好在它该在的位置。
        //   · collider：`ARCH_OUT.archBlocks`（内侧弓·后 + 内侧弓·前，离地 22mm）
        //   · `plateHidden: true` —— 靴子那张图由 `foot_*` **整张画**，
        //     弓再画一次会出现「两只脚」（用户 2026-10-04 报过）。
        //     弓转动时靴子网格由**顶点解算**跟着弓走（见 `柔性足设计.md` §4）。
        //   · 关节 `arch_*` 在**第二段**建（`joints` 声明之后）——
        //     因为 `joints` 的数组在 bodies 循环**之后**才声明。
        // ══ 下面这个块（弓 + 内侧前足）整体受 `flexibleArch` 开关控制。
        //   关掉 = 回退到“单刚体脚掉”（弓与内侧前足的 collider 都归回脚体、质量归回。
        //   用途 = **消融实验**。主动关掉时输出必须自洽（无 `undefined`、无漏刚体）。
        if (cfg.flexibleArch !== false) {
          const isL = spec.key === 'shin_l';
          const footKey = isL ? 'foot_l' : 'foot_r';
          const archKey = isL ? 'arch_l' : 'arch_r';
          bodies.push({
            key: archKey,
            bone: spec.bone,
            label: isL ? '左内侧弓' : '右内侧弓',
            part,
            // ★★★ 体心必须与 `foot_*` **完全相同** ⇒ 用 `ankleY`，不是 `cy`。
            //   `cy` 是**小腿肚**中心（实测 236.5mm），`ankleY` 才是踝/脚掌中心
            //   （实测 68.6mm）—— 两者差 168mm。
            //   弓的 collider 偏移 `offsetY` 是按**鞋底平面**（体心下方 68.6mm）算的，
            //   一旦体心放到小腿肚上，弓就整体**浮到膝盖附近 190mm 高空**（实测）。
            //   后果：踝上多出一坨 0.123kg 的单摆 ⇒ 腿的动力学全变，
            //   表现为「脚在自身重量下上下弹 + 打滑」，但短期看着反而更稳
            //   （那坨质量在膝附近蹭到了地面，形成虚假支撑）。
            //   ⚠ 上面那段注释写的「与 foot_* 同一个几何中心（cx/cy/cz 全同）」
            //     在 `cy` 这一项上一直是**假的** —— 注释说了，做法没跟上。
            cx: 0, cy: ankleY, cz: centerZ,
            restTiltRad: tilt,
            restYawRad: yaw,
            plateHidden: true,
            plateOffset,
            // ★ 弓的 `length/radius/halfHeight` 必须用**弓自己**的尺寸，不能继承小腿的。
            //   这三个字段对弓的**物理**无用（弓的 collider 全是 `archBlocks`），
            //   但骨骼调试视图对**每个刚体**都画一个胶囊：
            //       new THREE.CapsuleGeometry(b.radius, b.halfHeight * 2, ...)
            //   继承小腿尺寸 ⇒ 在脚掉位置画出一个**小腿那么长的胶囊垂到地面**，
            //   用户见到“巨长的关节”。
            //   改成弓自己的包围盒：长 81mm、厚 20mm、宽 28mm。
            length: ARCH_OUT.archDims.len,
            radius: ARCH_OUT.archDims.rad,
            halfHeight: ARCH_OUT.archDims.hh,
            mass: ARCH_OUT.archMass,
            colliders: ARCH_OUT.archBlocks,
            leg: true,
          });
          // ═══════════════════════════════════════════════════════════
          // ★ 内侧前足刚体 `mfoot_l/mfoot_r`（第一跳骨头）
          // ═══════════════════════════════════════════════════════════════
          //   │ 它是**串联链的末端**：`foot` → `arch` → **`mfoot`** → 地面。
          //   ├ 此前弓是脚掉内侧的**死端悬臂**，实测关节力仅 1N（自身重）。
          //   └ 当前添加：将**跳骨头的内侧半边**（第一跳骨头）分出来给它。
          bodies.push({
            key: isL ? 'mfoot_l' : 'mfoot_r',
            bone: spec.bone,
            label: isL ? '左内侧前足' : '右内侧前足',
            part,
            cx: 0, cy: ankleY, cz: centerZ,
            restTiltRad: tilt,
            restYawRad: yaw,
            plateHidden: true,           // 靿子那张图由 foot_* 整张画，再画会出现「两只脚」
            plateOffset,
            length: ARCH_OUT.archDims.len,
            radius: ARCH_OUT.archDims.rad,
            halfHeight: ARCH_OUT.archDims.hh,
            mass: ARCH_OUT.mfootMass,
            colliders: ARCH_OUT.mfootBlocks,
            leg: true,
          });
          // 存造关节需要的量（锚点在**世界系**，足长 archAtFrac 处）
          // ⚠⚠ `wx/wy/wz` 是**世界系**（主关节循环里 `wy = mapY(ayPx)`、`wz = parent.cz`，
          //   然后 `dParent = [wx − parent.cx, wy − parent.cy, wz − parent.cz]`）。
          //   之前我直接填了局部量（`wy = archRise = 22mm`），而脚体 `cy ≈ 80mm`
          //   ⇒ 锚点落到地面以下 ⇒ `assertJointAnchors` 直接判「超出包围球」。
          //     实测报错：`arch_r.P 局部(-155,-47,147)mm 超出 foot_r 包围球 57.7mm`。
          // ★ 锚点**从弓自己的 collider 偏移取**，不再推导鞋底平面高度。
          //   之前推 `wy = cy + local[1] + archRise` 得到局部 y = **+147mm**
          //   （脚体中心**上方** 147mm）⇒ `assertJointAnchors` 判
          //   「超出 foot_l 包围球」（实测 `arch_l.P 局部(-56,147,65)mm`）。
          //   ⇒ `local[1]` 不是"鞋底相对体心的偏移"（推导前提就错了）。
          //   改用**弓 collider 的实际偏移均值**：该点**必然在弓体内**，
          //   而弓与鞋底在足长/足宽上重叠 ⇒ 父侧也必然落在 foot_l 的 collider 内。
          // ★★★ 旋前轴（revolute 的自由轴 = 局部 X）的位置**决定弓能不能被压下去**。
          //
          //   绕 X 轴旋转时，高度变化 = Δy(cosθ−1) ≈ **−Δy·θ²/2**（二阶小量）
          //   —— 只有当被转的点与轴有**Δz** 间隔时，才有 Δy ≈ θ·Δz 的一阶竖向位移。
          //   ⚠ 我原来把锚点放在**弓块自己的中心**（`mOff`），而弓块的 z 与该轴相同
          //     ⇒ Δz = 0 ⇒ 旋前几乎不产生竖向位移，弓永远压不到地面
          //     （实测 `probe-archrise`：rise 从 22mm 降到 3mm，弓接触帧恒为 0%）。
          //
          //   解剖上真实的旋前轴 = 足底**外缘那条接地棱**，在**鞋底高度**、偏外侧。
          //   这样弓块（在 fz 0.40..1.00 的内侧）与轴的 Δz ≈ 131mm，
          //   压下 rise 需要的旋前角 θ = asin(rise / Δz)。
          const HWm = (SOLE_WIDTH_TARGET / 2) * cfg.soleFootScale;
          const rollZ = centerZ + (-0.70) * HWm;          // 外侧接地棱（fz≈−0.70）
          // ⚠⚠ 必须用 **`ankleY`**（脚掉/踝的体心），不能用 `cy`（**小腿腹**的体心，0.2365m）。
          //   用错了会让锚点落到 y=0.190（而非鞋底 0.022），
          //   表现为关节渲染出现一条**很长的关节线垂到地面**（用户见到）。
          //   这是本任务里**第二次栽在“用错体心变量”上（第一次是弓体心）。
          // 鞋底**平面**（y=0）—— 不是弓的底面。弓的底面比鞋底高 `archRise`，
          // 少减这一项锚点会落在 22mm 处（实测 0.022），旋前轴就不在接地棱上了。
          const rollY = ankleY + (ARCH_OUT.archBlocks[0]!.offsetY ?? 0)
                            - (ARCH_OUT.archBlocks[0]!.hy) - ARCH_OUT.archRise;
          ARCH_SPEC.push({
            side: isL ? 'l' : 'r',
            footKey,
            archKey,
            // ⚠⚠ collider 的 `offsetX/Y/Z` 是**刚体局部**，世界位置 = 体心 + 偏移。
            //   直接当世界用会让锚点落到体心下方 263mm（`arch_l.C 局部 y=−263`）。
            //   这是本任务里第**三**次栽在“局部/世界混用”上（前两次：`wy=archRise`、
            //   `local[1]` 推导），所以这里把三个分量一次性写全。
            wx: 0,                        // 脚体 cx = 0
            wy: rollY,                    // 鞋底底面（旋前轴的高度）
            wz: rollZ,                    // 外侧接地棱（旋前轴的侧向位置）
            massFrac: ARCH_OUT.archMass / Math.max(1e-6, soleMass),
            // ★ 内侧前足接在弓的远侧端：弓的远端 fx = +0.145
            mfootKey: isL ? 'mfoot_l' : 'mfoot_r',
            mwx: ARCH_OUT.mfootCx,
            mwy: rollY,
            mwz: rollZ,
          });
        }

        // ══════════════════════════════════════════════════════════════
        // ★★★ 柔性足 F1：**前足刚体**（`forefoot_l` / `forefoot_r`）
        // ══════════════════════════════════════════════════════════════
        //   · 位置：中足关节处（足长的 `forefootAtFrac`，默认 0.5 = 几何中心）
        //   · collider：原「前脚掌」那两块（内/外侧柱），`offsetX` 减掉自身原点偏移
        //   · `plateHidden`：前足**不画贴图** —— 靴子那张图已由 `foot_*` 整张画，
        //     两边都画会出现「两只脚」（用户 2026-10-04：「有了踝关节现在纹理变成两个脚了」）
        //   · 关节：`midfoot_l` revolute **绕足长轴（局部 X）** = 距下关节旋前/旋后


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
          // ★★★★★ 2026-10-07 **小腿偏航归零**（本会话最终的物理根）：
          //   原为"脚尖朝前"的造型把 ±17° 偏航加在小腿上 ⇒ 踝的转轴（局部分量）
          //   被拧歪 17°，垂直力投影到歪轴上凭空产生 40+ N·m（确诊链：轴 a=(−0.42,0,0.91)）。
          //   修正：偏航只留在**脚掌**（造型不变），小腿坐标系回正 ⇒ 踝轴回到世界横向。
          restYawRad: 0,
          plateOffset,
          // ★ 去掉底部那块靴子（它归脚掌板）⇒ 画面上只有一只脚，
          //   且两块拼回原图（uv 互补，见上面 footFrac 处的注释）。
          plateUv: shinPlateUv,
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
          // ★★★★★ 2026-10-06 **这里才是"中线 +7mm"的真身**（`probe-init` 追出来的）：
          //   分段体**直接**从源画布 `part.cx` 重推 z（`mapZ`），**绕过**了上面
          //   `centerZ` 的修正 ⇒ 躯干/脊柱整段 z=+7mm ⇒ CoM 第 0 拍 +2.85mm。
          //   ⇒ 中线（脊柱）强制 z = 0；`CENTERC=0` 可关（A/B）。
          cz: ['0', 'false', 'off'].includes(String(
            ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).CENTERC ?? '').trim().toLowerCase())
            ? mapZ(part.cx, false) : 0,
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
  // ══════════════════════════════════════════════════════════════
  // ★★ 不变式后处理：**刚体质量 := 其 collider 质量之和**
  // ══════════════════════════════════════════════════════════════
  //   `assertColliderMass` 要求逐刚体 `Σ collider.mass == body.mass`。
  //   ⚠ 这个不变式**不能靠两处手工公式对齐**来维持 —— 柔性足 F2 拆出弓刚体时，
  //     我在 IIFE 外又写了一遍体积公式给刚体质量用，与 IIFE 内的版本差了 0.29%
  //     ⇒ 实测 `foot_l collider 0.8923320182810784 ≠ 刚体 0.8949143265111851`，
  //     而且为此反复试了六七轮都没收敛。
  //   ⇒ 改成**按构造成立**：collider 是质量的唯一真源，刚体质量从它求和。
  //     这样"脚底拆走两块"这类改动**不需要任何手工同步**。
  for (const b of bodies) {
    if (!b.colliders || b.colliders.length === 0) continue;
    b.mass = b.colliders.reduce((a, c) => a + (c.mass ?? 0), 0);
  }

  const joints: JointDef[] = [];
  // ★ 柔性足 F1：中足关节在腿循环里收集（那里才有 `midX`/`local[1]`），此处统一编号
  // ★ 踝关节受 `ankleEnabled` 控制（默认关）。JOINT_ORDER 里始终有 foot_l/foot_r
  //   （网络维度按它算，保持稳定），关掉时**不建这两个关节**、脚掌也不拆成独立刚体。
  const JOINT_ORDER_ACTIVE = JOINT_ORDER.filter((n) => cfg.ankleEnabled || !n.startsWith('foot_'));
  JOINT_ORDER_ACTIVE.forEach((name, index) => {
    const jm = jointMetaByName.get(name);
    if (!jm) throw new Error(`[skeleton] parts.json 缺少关节 ${name}`);
    // ★ 踝关节的子刚体是"脚掌"：它**没有自己的贴图**（脚还在小腿那张 PNG 里），
    //   所以 PART_BY_KEY 里查不到 —— 借用小腿的部件元数据即可（渲染层会跳过它的板）。
    const isAnkle = jm.child === 'foot_l' || jm.child === 'foot_r';
    // ★ 髋：外展轴要单独给权限（Inman 静态需求 112 N·m 已占 0.6×200 的 93%）
    const isHip = /^hip_[lr]$/.test(jm.name);   // ★ 是**关节名**；`jm.child` 是子刚体名（thigh_l）
    // ★ 膝（knee_l/knee_r）走 revolute（与踝同机制）——见 `revoluteAxis` 处长注释
    // ★★★★★ 2026-10-06 **默认仍是 ball**（revolute 实测是**大回归**，opt-in 保留）：
    //   用户提出「膝撑不住、反向折断，参考脚踝的实现」⇒ 试着把膝做成 revolute
    //   （与踝同机制：引擎级限位 + 锁侧向/扭转）。**限位效果完全达到**
    //   （`knee/2` 过伸从违例清单消失），**但整机行为崩了**：
    //     真倒 **3.71 s → 1.56 s**、倒地前滑移 119/43 → **242/618 mm**（A/B 干净）。
    //   读法：膝的**球面自由度本来在承力**（小腿的侧向/扭转让髋-膝-踝的运动链
    //   有"让量"），硬铰链把这条链变成过约束 ⇒ 接触力与腿链对顶。
    //   ⇒ 正确的路不是"锁死膝"，而是**让腿链的几何/IK 与铰链匹配**（下一轮议题）。
    //   `KNEE_REVOLUTE=1` 可开做对照。
    const isKnee = ['1', 'true', 'on'].includes(String(
      ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).KNEE_REVOLUTE ?? '').trim().toLowerCase())
      && (jm.name === 'knee_l' || jm.name === 'knee_r');
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
    // ★★ 2026-10-04：踝锚点的 z **必须用小腿中轴 `parent.cz`**，不能用素材实测的
    //   `mapZ(axPx)`。后者带着"外八"的横向偏移（膝→踝不是铅垂，实测 ±42mm），
    //   而小腿与脚掌两个刚体**都**已经放在 `centerZ` 上（见下方脚掌 `cz: centerZ`
    //   那段「让脚部关节对称轴对着小腿的对称轴」的注释）。
    //   ⇒ 锚点落在中轴外 ⇒ 局部锚点 z = ±42mm，`assertJointAnchors` 报
    //     `foot_l.P 局部(20,−208,42) 超出 shin_l 包围球 10.2mm`，
    //     而且球关节会在**空处**建铰链（实测踝在中轴外 ⇒ 受力臂偏、还多一个
    //     恒定侧向偏置）。外八已经由 `restYawRad = restYawOf(...)` 单独表达了。
    const wz = isAnkle ? parent.cz : mapZ(axPx, stanceHere);
    // ★★ 腿段拉伸（2026-10-02）：素材的**髋高 0.849 m 大于腿长 0.785 m**
    //   ⇒ 站直时膝天生折 ~30°，腿/髋 = 0.92 低于人体常态 0.95~1.0。
    //   实测后果：躯干持续前倾 35.8°、CoM 前移 0.46 m、平衡门因此永远不放行。
    //   `legStretch` 把**膝/踝锚点相对髋下沉**，把腿等比拉长到 leg/hip ≈ 0.97。
    //   （另一种是降髋锚点，但那会让大腿根部脱开素材 88mm；拉伸只动 39mm。）
    const stretch = /^(knee|foot)_/.test(name) ? cfg.legStretch : 0;
    const wy = mapY(ayPx) - stretch * (legKeys.has(jm.parent) ? 1 : 0);
    // ⚠ `wz` 在上面已按 `isAnkle ? parent.cz : mapZ(axPx, …)` 算好，别重复声明。

    const xy = JOINT_LIMITS_XY_DEG[name] ?? [20, 20];
    // ★ 踝的屈伸限位改用 `cfg.ankleLimitDeg`（机械硬限位，见 SkeletonConfig 注释），
    //   **不用**素材的 `limitDeg`：后者是画出来的姿态范围，实测会被力矩甩出去 −35°
    //   （超素材限位 17°）⇒ 脚翻 / 崴脚。踝是唯一能搬 CoP 的执行器，必须锁死。
    //   `isAnkle` 已在上方定义（按子刚体判定）
    const flexMin = (isAnkle ? cfg.ankleLimitDeg[0] : jm.limitDeg[0]) * DEG;
    const flexMax = (isAnkle ? cfg.ankleLimitDeg[1] : jm.limitDeg[1]) * DEG;
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
      // ★ 踝（foot_l/foot_r）走 revolute：自由转轴 = 局部 Z（= 屈伸，见 AXIS_* 约定）
      // ★★★★★ 2026-10-06 **膝也照踝做**（用户：「可能问题在**膝盖撑不住了**，
      //   直接**反向折断**了，需要**参考脚踝的实现**」）：
      //   踝之所以"撑得住"，是因为它是 `RevoluteImpulseJoint` + **引擎级限位**
      //   （`joint.setLimits`，由求解器直接管）；而膝此前是 **ball 关节**，
      //   只靠自研的冲量限位（`enforceLimits`）——实测它在落地冲击下
      //   **过伸到 +19.8°（限位 +2°）**、侧向 −24.5°（限位 −6°）、扭转 13°（±8°）
      //   ⇒ 肉眼就是"**反向折断**"。
      //   ⇒ 膝改成 revolute（只放开屈伸 Z）：
      //     ① 屈伸限位 [−145°, +2°] 交给**求解器**（与踝同机制，稳）；
      //     ② 侧向/扭转两轴**被引擎锁死** ⇒ 那两类超限从根上消失。
      //   （人体膝本来就是**铰链**；`LEGACY_KNEE_BALL=1` 可回退 ball 对照。）
      revoluteAxis: (isAnkle || isKnee) ? ([0, 0, 1] as const) : undefined,
      // ★★ 髋**外展轴**用独立倍率（不动全局 `TORQUE_AXIS_FACTOR`，否则
      //   颈/肩/肘的外展轴会跟着变粗 —— 那三个的次要轴是**刻意压小**的，
      //   见 `JOINT_LIMITS_XY_DEG` 的注释）。
      //
      //   为什么撤掉"不超人"的余量（用户 2026-10-05 明确）：
      //   「人体骨骼承重很大的，不要设承重上限」。
      //   此前 hip=200 × 0.60 = **120 N·m**，而 Inman 1947 的静态需求
      //   （体重 × 半髋间距 = 687 × 0.163 = 112 N·m）就占掉 93% ——
      //   剩下 29% 余量不足以同时**托住**和**搬运**重心。
      //   2026-10-04 曾试 hip=250（外展 150）而无效，当时的判定是
      //   「矢状面没稳住，额度是假象」；现在额状机制（Winter 刚度伺服 +
      //   锁定承诺 + 载荷依赖张力）已就位，值得重测。
      //
      //   口径：髋外展轴取**与屈伸轴同量级**（1.00 而非 0.60），
      //   即 τmax(hip/0) = hip_l 的 τ = 200 N·m。
      //   ⚠ 这是**工程余量**，不是解剖上限；真实股骨/髋臼能承受的远高于此。
      maxTorque: [
        tau * (isHip ? cfg.hipAbdTorqueFactor : TORQUE_AXIS_FACTOR[0]),
        tau * TORQUE_AXIS_FACTOR[1],
        tau * TORQUE_AXIS_FACTOR[2],
      ],
    });
  });

  // ══════════════════════════════════════════════════════════════
  // ★ 柔性足 F2 第二段：**弓关节** `arch_l` / `arch_r`
  // ══════════════════════════════════════════════════════════════
  //   revolute **绕足长轴（局部 X）** = 距下关节旋前/旋后。
  //   `revoluteAxis` 的约定与踝一致（踝用 `[0,0,1]` 表示"只放开局部 Z"），
  //   这里要放开 X ⇒ `[1,0,0]`。
  //
  //   限位 **−4° ~ +16°**：正 = **旋前**（内侧弓向下踩实）。
  //   ⚠ 为什么不给到"能踩实"的 ~28°（`atan(22mm / 弓区半长 40mm)`）：
  //     踩平会让脚变成**平板**、弓形消失，反而丧失 `Lugade & Kaufman 2014`
  //     要求的 CoP 行程（足宽 27%）。目标是**"弓能踩下一部分"**，不是"踩平"。
  //
  //   ⚠ 中足关节当初被删掉的原因就是**塌陷**。但正确结论是
  //     **"缺限位和阻尼"**，不是"不该有中足关节"⇒ 限位在这里、
  //     阻尼在 `ragdoll.ts` 的 `jointGain` 覆盖（与踝同一套机制）。
  //
  //   锚点换算必须**扣除静倾角/静偏航**（与主关节循环同一套 `rotVecByQuat`），
  //   否则 Rapier 会在错误的点上建铰链、一 reset 就错位。
  for (const as of ARCH_SPEC) {
    const parent = byKey.get(as.footKey);
    const child = byKey.get(as.archKey);
    if (!parent || !child) throw new Error(`[skeleton] 弓关节 ${as.archKey} 的刚体不存在`);
    const dParent = rotVecByQuat(invQuatOf(restQuatOf(parent.restTiltRad, parent.restYawRad)),
      [as.wx - parent.cx, as.wy - parent.cy, as.wz - parent.cz]);
    const dChild = rotVecByQuat(invQuatOf(restQuatOf(child.restTiltRad, child.restYawRad)),
      [as.wx - child.cx, as.wy - child.cy, as.wz - child.cz]);
    const tauArch = cfg.ankleTorque * 0.25;   // 被动承载件，不是主动执行器
    joints.push({
      name: as.archKey,
      index: joints.length,
      parentKey: as.footKey,
      childKey: as.archKey,
      wx: as.wx, wy: as.wy, wz: as.wz,
      parentLocal: dParent,
      childLocal: dChild,
      // 弓的静姿态与足体**相同**（建模时就是同姿态）⇒ 关节零位 = 素材姿势
      restRad: [0, 0, 0],
      minRad: [cfg.archLimitDeg[0] * DEG, -20 * DEG, -25 * DEG],
      maxRad: [cfg.archLimitDeg[1] * DEG, 20 * DEG, 25 * DEG],
      revoluteAxis: [1, 0, 0],
      maxTorque: [tauArch, tauArch, tauArch],
    });
    // ★★ 内侧前足关节：父 = **弓**（不是 foot）。
    //   这一个引擎才是整个串联拉整的关键：足跟传力给弓、弓再传给
    //   内侧前足、内侧前足接地——足弧从此在载荷路径上，不接地也承重。
    const mfoot = byKey.get(as.mfootKey);
    if (!mfoot) throw new Error(`[skeleton] 内侧前足 ${as.mfootKey} 的刚体不存在`);
    const mParent = rotVecByQuat(invQuatOf(restQuatOf(child.restTiltRad, child.restYawRad)),
      [as.mwx - child.cx, as.mwy - child.cy, as.mwz - child.cz]);
    const mChild = rotVecByQuat(invQuatOf(restQuatOf(mfoot.restTiltRad, mfoot.restYawRad)),
      [as.mwx - mfoot.cx, as.mwy - mfoot.cy, as.mwz - mfoot.cz]);
    joints.push({
      name: as.mfootKey,
      index: joints.length,
      parentKey: as.archKey,
      childKey: as.mfootKey,
      wx: as.mwx, wy: as.mwy, wz: as.mwz,
      parentLocal: mParent,
      childLocal: mChild,
      restRad: [0, 0, 0],
      minRad: [cfg.archLimitDeg[0] * DEG, -20 * DEG, -25 * DEG],
      maxRad: [cfg.archLimitDeg[1] * DEG, 20 * DEG, 25 * DEG],
      revoluteAxis: [1, 0, 0],
      maxTorque: [tauArch, tauArch, tauArch],
    });
  }

  // ---- ★ 脊柱关节（K−1 个）：连接相邻两段，锚点在两段的交界面上 ----
  if (K > 1) {
    const SPINE_XY_DEG: readonly [number, number] = [15, 20];   // [侧倾, 扭转]
    const SPINE_FLEX_DEG: readonly [number, number] = [-25, 25];
    // 额状面文献预算（备用，见 JOINT_MAX_TORQUE.hip_l 的注释）：
    //   腰椎侧屈是额状面主执行器 —— 文献实测「侧屈到一半 ⇒ 髋外展需求 −37%」
    //   （112 → 71 N·m）。2026-10-04 试过 120 → 180（侧屈轴 72 → 108 N·m），
    //   实测对单支撑建立无帮助、存活略降 ⇒ **回退 120**，等矢状面稳住再启用。
    const SPINE_TAU = 170;   // ★ 单腿站立实测：侧向 72 N·m/节 几百帧全饱和（"增强腰的控制能力"，强肌肉定调）
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
 * 自检：关节锚点必须落在父子刚体的**实际碰撞体**范围内（三维）。
 * 2D 版只校 Y，3D 之后必须连 Z 一起校 —— 侧向锚点飘出去的话，
 * 球关节会把父子刚体硬拽在一起，初始姿态就会自己抖起来。
 *
 * ★★ 2026-10-04 修：原来用 `reach = body.halfHeight + body.radius`，
 *   那是**胶囊型肢体**的写法（刚体原点就在胶囊中心）。但脚掌/前掌的碰撞体是
 *   **带 offset 的扁盒**（`offsetY ≈ −42 mm`，`hy ≈ 26 mm`），body 级的
 *   `halfHeight/radius` 完全描述不了质量实际在哪 ⇒ 脚踝/中足锚点被**误报越界**
 *   （实测 `midfoot_l.P |d|=42.4mm > reach=34.3mm`，而那个点其实正好在盒中心）。
 *   ⇒ `reach` 改为**包住所有碰撞体的球半径**（逐 collider 算，取最大）。
 *     胶囊：到轴线段的距离 + 半径；扁盒：到最远角点的距离。
 *
 *   ⚠ 口径保持"宽松的包围球"，**不要**改成"锚点必须在碰撞体内部"：
 *     肩/髋锚点本来就落在细躯干胶囊的**外侧**（实测肩离 spine4 中轴 188mm、
 *     躯干半径只有 136mm），按"必须在内部"判会误报 50~78mm。
 *     这条断言的意图是"锚点没有飘到 body's extent 之外"，不是"锚点在体内"。
 */
export function assertJointAnchors(sk: Skeleton): number {
  /** 包住该刚体全部碰撞体的球半径（从刚体原点量起） */
  const reachOf = (b: BodyDef): number => {
    let r = 0;
    for (const c of b.colliders) {
      const ox = c.offsetX ?? 0;
      let d: number;
      if (c.shape === 'capsule') {
        // ⚠ 刚体原点在**近端关节**上，不在胶囊中心 ⇒ 胶囊的 `offsetY` 通常非零。
        //   包围球半径 = 到**最远那端**的距离 + 半径（不是到轴线段的距离）。
        const ay = c.offsetY - c.halfHeight, by = c.offsetY + c.halfHeight;
        d = Math.max(Math.hypot(ox, ay, c.offsetZ), Math.hypot(ox, by, c.offsetZ)) + c.radius;
      } else {
        // 到最远角点
        d = Math.hypot(
          Math.abs(ox) + c.hx,
          Math.abs(c.offsetY) + c.hy,
          Math.abs(c.offsetZ) + c.hz,
        );
      }
      if (d > r) r = d;
    }
    return r;
  };

  let worst = 0;
  for (const j of sk.joints) {
    const p = sk.bodies.find((b) => b.key === j.parentKey)!;
    const c = sk.bodies.find((b) => b.key === j.childKey)!;
    for (const [b, l, tag] of [[p, j.parentLocal, 'P'], [c, j.childLocal, 'C']] as const) {
      const reach = reachOf(b);
      const d = Math.hypot(l[0], l[1], l[2]);
      const over = d - reach;
      if (over > worst) worst = over;
      if (over > 1e-4) {
        // eslint-disable-next-line no-console
        console.log(`      [越界] ${j.name}.${tag} 局部(${l.map((v) => (v * 1000).toFixed(0)).join(',')})mm `
          + `超出 ${b.key} 的包围球 ${(over * 1000).toFixed(1)}mm（reach=${(reach * 1000).toFixed(1)}mm）`);
      }
    }
  }
  return worst;
}
