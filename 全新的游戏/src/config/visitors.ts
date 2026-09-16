// ============================================================
// visitors.ts —— 访客名册（每名访客独立纹理 / 对话 / 体型）
// ============================================================
// 设计（2026-09-15 用户定）：
//   · 每天落地时全部访客在舰船附近出现，走进舰内；
//   · 身体 = 现成 GLB 模型（Kenney "Mini Characters 1"，CC0）——
//     **5 名访客共用同一模型**（public/models/visitors/visitor.glb，~240KB），
//     差异全靠"脸上糊各自的纹理"（模型自带 idle/walk/sprint 骨骼动画）；
//   · 程序化 Q 版身体（VisitorBodyStyle）仍保留为可选后备（def.body）。
// 新增访客：在 VISITORS 加一条 + 在 dialogues.json 加对应对话树即可。

import type { VisitorDef } from '../entity/VisitorNpc';

/** 共用模型路径（Kenney Mini Characters 1 · character-male-a，CC0） */
const VISITOR_MODEL_URL = '/models/visitors/visitor.glb';

export const VISITORS: VisitorDef[] = [
  {
    id: 'zc',
    name: 'ZC',
    assetUrl: '/characters/protagonist/zc.ftx3.gz',
    dialogue: 'visitor_zc',
    moveSpeed: 3.1,
    model: { url: VISITOR_MODEL_URL, height: 3.3 },
  },
  {
    id: 'buxiaoxiao',
    name: '不许笑',
    assetUrl: '/characters/protagonist/不许笑.ftx3.gz',
    dialogue: 'visitor_buxiaoxiao',
    moveSpeed: 3.0,
    model: { url: VISITOR_MODEL_URL, height: 3.1 },
  },
  {
    id: 'tutou',
    name: '兔头',
    assetUrl: '/characters/protagonist/兔头.ftx3.gz',
    dialogue: 'visitor_tutou',
    moveSpeed: 3.4,
    model: { url: VISITOR_MODEL_URL, height: 2.9 },
  },
  {
    id: 'jiaofu',
    name: '教父',
    assetUrl: '/characters/protagonist/教父.ftx3.gz',
    dialogue: 'visitor_jiaofu',
    moveSpeed: 2.9,
    model: { url: VISITOR_MODEL_URL, height: 3.4 },
  },
  {
    id: 'shenren',
    name: '神人',
    assetUrl: '/characters/protagonist/神人.ftx3.gz',
    dialogue: 'visitor_shenren',
    moveSpeed: 3.2,
    model: { url: VISITOR_MODEL_URL, height: 3.2 },
  },
  {
    id: 'yjwangzi',
    name: '鹰叫王子',
    assetUrl: '/characters/protagonist/鹰叫王子.ftx3.gz',
    dialogue: 'visitor_yjwangzi',
    moveSpeed: 3.1,
    model: { url: VISITOR_MODEL_URL, height: 3.3 },
  },
];
