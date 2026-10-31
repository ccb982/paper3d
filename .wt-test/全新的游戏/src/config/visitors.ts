// ============================================================
// visitors.ts —— 访客名册（每名访客独立纹理 / 对话 / 体型）
// ============================================================
// 设计（2026-09-15 用户定）：
//   · 每天落地时全部访客在舰船附近出现，走进舰内；
//   · 身体 = 现成 GLB 模型（Quaternius "Cube Guy"，CC0，334KB）——
//     **7 名访客共用同一模型**（public/models/visitors/visitor_cubeguy.glb），
//     模型自带 idle/walk/run 骨骼动画，贴图为 32×32 内嵌 Atlas（自包含，无外部依赖）。
//   · 程序化 Q 版身体（VisitorBodyStyle）仍保留为可选后备（def.body）。
//
// ★ 换模型记录（2026-09-16 用户定：Cube Guy「更自然一些」）：
//   原模型 Kenney "Mini Characters 1" 换为 Quaternius "Cube Guy"。
//   与旧模型的三处关键差异（换模型时必须知道）：
//     ① 动画名是三层嵌套 `CharacterArmature|CharacterArmature|CharacterArmature|Idle`
//        （旧模型是干净的 `idle`/`walk`/`sprint`）→ 已在 VisitorModelRenderer
//        的 pickClipName 里按「末段匹配」处理，无需在此覆盖；
//     ② **没有独立头部网格**，全身是一整块 `Character` 蒙皮网格（3122 三角面、单张 Atlas）；
//     ③ 贴图是一张 **32×32 的 8 色调色板**，整个模型**只采样 8 个 UV 坐标**
//        （全部落在 v≈0.307..0.329 窄带）→ 没有"画好的脸"可复用。
//
// ★ 换脸（2026-09-16 用户要求「脸上要削平贴纹理」）—— 经 **4 轮**探针修正后的最终方案：
//
// 【第 1 轮错误】以为"脸是弧面、需要削平" → 探针实测**脸面层本身就是严格共面的**
//   （y 跨度 3e-9），根本不需要削平。之前算出的 0.0038"起伏"是把耳朵算进正脸
//   导致的**统计口径错误**。
// 【第 2 轮错误】把"正脸判定"从法线阈值改成"取最靠前那一层"时，**投影方向写反**，
//   选中了后脑层（y=+0.005707）→ 立绘整片糊到后脑勺，用户当场指出。
// 【第 3 轮错误】★★ 用户原话：「你把头顶头发弄没了，而且纹理绘制在前面头发上，
//   **是不是分不清头顶头发和脸**」—— 精准命中。两个 bug：
//     ① `stripFaceDetails` 拿 "z >= 脸面上沿 0.026036" 当头发削掉 → 头是**封闭
//        方盒**，这等于把**整个头顶**削了；
//     ② `remapFaceUV` 拿"最靠前那一层"当脸 → 它是 y=-0.005707 的 33 个顶点，
//        形状是**左侧鬓角 + 额前刘海**（L 形：下半边只有左半边，上半边才全宽），
//        **根本不含眼睛** → 立绘糊在额头上，用户看到的就是"纹理画在头发上"。
// 【第 4 轮定案】探针（probe17-24）把这个头的真实层级彻底摸清：
//   · z 45.1%..53.4% (0.021003..0.022119) ← **眼睛浮雕**（法线朝前，在前脸片**下方**）
//   · z 53.6%..88.3% (0.022144..0.026818) ← **前脸片主体**（含额头）
//   · z >= 82.5%   (0.026036..)           ← **头发盖**（薄圈带 352 面 + 顶隆起 110 面）
//   · ★ **射线探针证明：脸区 45%~82% 高度内 0 个采样点被头发遮挡** ——
//     本模型**不存在"垂在脸前的刘海"**，头发全在 82.5% 以上。
//
// 最终做法（用户定调：「整个前脸片全削平再贴」+「头发只去掉靠近脸的，其余保留」）：
//   · `faceMode: 'plate'`：**把前脸片几何真正压平**（把 z∈[0.0210, 0.026036] 且
//     前向投影 >= 0.0038 的顶点沿脸朝向推到同一平面 y=-0.00585，法线拉直），
//     再把这块平面的 UV 重映射到贴图空白区（u 0..6/32, v 23/32..1）画立绘。
//     ★ 必须"压平几何"而不是只改 UV —— `remap` 只改 UV 时凸起的共面小方板
//       照样看得见，做不出"平"。
//   · 眼睛浮雕在 0.0210 之下 → 压平后本该落在平面之后；但用户看过渲染后定调
//     「把眼睛删了就行了」→ 现已**整面删除**（`removeEyes`，实测命中 100 面）。
//     删面只重排索引、不动顶点缓冲 → 蒙皮零错位，也不会在脸颊/发际线留洞。
//   · 头发**完全不动**：射线探针证明它不挡脸，且用户要保留。
//   · 不再需要 `stripFaceDetails`（删面方案实测会挖出 448 条边界边、头顶前部全空）。
//
// 新增访客：在 VISITORS 加一条 + 在 dialogues.json 加对应对话树即可。

import type { VisitorDef } from '../entity/VisitorNpc';

/** 共用模型路径（Quaternius "Cube Guy"，CC0，334KB，贴图内嵌） */
const VISITOR_MODEL_URL = '/models/visitors/visitor_cubeguy.glb';

/** ★ 共用外观（7 名访客一致；差异靠对话/体型/移速体现） */
const VISITOR_MODEL = {
  url: VISITOR_MODEL_URL,
  /** ★ 换脸（2026-09-16 用户要求）：削平/贴纹理 —— 见文件头说明 */
  swapFace: true,
  /** ★★★ 最终策略 'plate'：把前脸片几何**真正压平**再贴立绘。
   *  （'remap' 只改 UV、几何照样凸，做不出用户要的「纯平脸」。） */
  faceMode: 'plate' as const,
  /** ★ 该模型是 FBX 惯例：局部 **y = 前后**、**z = 高度**。
   *  ★★ 脸在 **-y** 方向（probe10 手算节点四元数实测：局部 -y → 世界 +Z，
   *     而游戏里 yaw=atan2(dx,dz) 即"局部前向 = 世界 +Z"）。符号判错 = 立绘糊后脑勺。 */
  frontAxis: '-y' as const,
  upAxis: 'z' as const,
  /** ★ 删掉眼睛浮雕（用户定调「把眼睛删了就行了」）。
   *  实测命中 100 个三角面（10 个共面层，z 0.0210..0.0223 / |x| 0.0017..0.0060）。
   *  只重排索引、不动顶点缓冲 → 蒙皮零错位。缺省 true，这里显式写出以表明意图。 */
  removeEyes: true,
  /** ★ 脸面片范围（probe17-24 实测；压平范围 + UV 映射范围都用它）。
   *  z0 = 头盒底面 0.014933（★ 用户定调「扩大脸面到整个头正面」→ 从下巴起，
   *       不是眼睛下沿）；z1 = 发际线 0.026036（头发从这里起，不动头发）。
   *  这样脸面 ≈ 0.0130 宽 × 0.0111 高 = 1.17:1 近方形，立绘比例自然。 */
  facePlate: {
    z0: 0.014933,
    z1: 0.026036,
    /** 参与压平的"最靠后"前向投影（只压比这更靠前的顶点，别把后脑/脖子拉进来） */
    projMin: 0.0038,
    /** 压平后的平面投影值（实测最前 0.005707 + 少量凸出消 z-fighting） */
    flatProj: 0.00585,
  },
  /** ★ 脸图区：贴图**下方空白区**（模型自用 texel 全在 v≈0.308..0.328，此区实测无采样）。
   *  ★★ 矩形**宽高比必须与脸面宽高比一致**（脸面 1.169:1）→ 立绘不用裁切、不会被拉伸。
   *  取 v 0.62..1（高 0.38 = 194px），宽 = 194×1.169 = 227px → u 0..0.4434。 */
  faceRect: { u0: 0, u1: 0.4434, v0: 0.62, v1: 1 },
} as const;

export const VISITORS: VisitorDef[] = [
  {
    id: 'zc',
    name: 'ZC',
    assetUrl: '/characters/protagonist/zc.ftx3.gz',
    dialogue: 'visitor_zc',
    moveSpeed: 3.1,
    model: { ...VISITOR_MODEL, height: 3.3 },
  },
  {
    id: 'buxiaoxiao',
    name: '不许笑',
    assetUrl: '/characters/protagonist/不许笑.ftx3.gz',
    dialogue: 'visitor_buxiaoxiao',
    moveSpeed: 3.0,
    model: { ...VISITOR_MODEL, height: 3.1 },
  },
  {
    id: 'tutou',
    name: '兔头',
    assetUrl: '/characters/protagonist/兔头.ftx3.gz',
    dialogue: 'visitor_tutou',
    moveSpeed: 3.4,
    model: { ...VISITOR_MODEL, height: 2.9 },
  },
  {
    id: 'jiaofu',
    name: '教父',
    assetUrl: '/characters/protagonist/教父.ftx3.gz',
    dialogue: 'visitor_jiaofu',
    moveSpeed: 2.9,
    model: { ...VISITOR_MODEL, height: 3.4 },
  },
  {
    id: 'shenren',
    name: '神人',
    assetUrl: '/characters/protagonist/神人.ftx3.gz',
    dialogue: 'visitor_shenren',
    moveSpeed: 3.2,
    model: { ...VISITOR_MODEL, height: 3.2 },
  },
  {
    id: 'yjwangzi',
    name: '鹰叫王子',
    assetUrl: '/characters/protagonist/鹰叫王子.ftx3.gz',
    dialogue: 'visitor_yjwangzi',
    moveSpeed: 3.1,
    model: { ...VISITOR_MODEL, height: 3.3 },
  },
  {
    id: 'puruiyinshua',
    name: '普瑞印刷',
    assetUrl: '/characters/protagonist/普瑞印刷.ftx3.gz',
    dialogue: 'visitor_puruiyinshua',
    moveSpeed: 3.0,
    model: { ...VISITOR_MODEL, height: 3.2 },
  },
];
