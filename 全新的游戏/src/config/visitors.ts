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
// ★ 换脸（2026-09-16 用户要求「脸上要削平贴纹理」）：
//   该模型头部正脸**本身就是平的**（局部 y=+maxY 那一面，法线 (0,1,0)），
//   所以**不需要也删不了面片**（旧模型那套"删正面补平板"在这会挖空整个身体正面）。
//   采用 `faceMode: 'remap'`（见 VisitorModelRenderer.remapFaceUV）：
//   **只把"头部主导 + 法线朝前"的顶点 UV 重映射**到贴图左上角一块实测无占用的
//   空白区（u 0..6/32, v 23/32..1），再把各自立绘画到那块 —— 立绘就贴在脸上，
//   且身体 UV 一个没动，不会串色。脸随骨骼动画完美变形。
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
  /** ★ 重映射策略：只改正脸顶点 UV（该模型是单块网格 + 调色板贴图） */
  faceMode: 'remap' as const,
  /** ★ 该模型是 FBX 惯例：局部 **y = 前后**、**z = 高度**。
   *  ★★ 脸在 **-y** 方向（实测：+z 相机看到脸，而 mesh 节点带 -90° X 旋转 →
   *     局部 -y 映射到世界 +z）。**符号判错 = 立绘糊在后脑勺**。 */
  frontAxis: '-y' as const,
  upAxis: 'z' as const,
  /** ★ 正脸判定：法线的 -y 分量 < -0.95（实测最干净 —— 只圈出那块平坦正脸，
   *  不带到侧脑/头顶；阈值放宽到 0.7 会把眼睛行拉到发际线上）。 */
  faceFacingMin: 0.95,
  /** ★ 脸图区：贴图左上角 6×9 texel 空白区（实测无顶点采样；避开模型自用 v≈0.307..0.329） */
  faceRect: { u0: 0 / 32, u1: 6 / 32, v0: 23 / 32, v1: 1 },
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
