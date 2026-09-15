// ============================================================
// visitors.ts —— 访客名册（每名访客独立纹理 / 对话 / 身体配色）
// ============================================================
// 设计（2026-09-15 用户定）：
//   · 每天世界上生成 1~2 名访客，向舰船行进 → 进舰内房间；
//   · 纹理 = 各自 FTX（脸 = 首帧/"前"帧 CPU 合成，贴到程序化身体头上）；
//   · 程序化身体：球头 + 方盒身 + 关节胶囊四肢（VisitorBodyStyle）。
// 新增访客：在 VISITORS 加一条 + 在 dialogues.json 加对应对话树即可。

import type { VisitorDef } from '../entity/VisitorNpc';

export const VISITORS: VisitorDef[] = [
  {
    id: 'zc',
    name: 'ZC',
    assetUrl: '/characters/protagonist/zc.ftx3.gz',
    dialogue: 'visitor_zc',
    moveSpeed: 3.1,
    body: { height: 1.85, bodyColor: 0x6f7d8c, limbColor: 0x59636e, accentColor: 0xc9803a },
  },
  {
    id: 'buxiaoxiao',
    name: '不许笑',
    assetUrl: '/characters/protagonist/不许笑.ftx3.gz',
    dialogue: 'visitor_buxiaoxiao',
    moveSpeed: 3.0,
    body: { height: 1.72, bodyColor: 0x8fae9b, limbColor: 0x6f8a7a, accentColor: 0xd9c9a8 },
  },
  {
    id: 'tutou',
    name: '兔头',
    assetUrl: '/characters/protagonist/兔头.ftx3.gz',
    dialogue: 'visitor_tutou',
    moveSpeed: 3.4,
    body: { height: 1.62, bodyColor: 0xe8e2e6, limbColor: 0xcfc6cc, accentColor: 0xe6a8bc },
  },
  {
    id: 'jiaofu',
    name: '教父',
    assetUrl: '/characters/protagonist/教父.ftx3.gz',
    dialogue: 'visitor_jiaofu',
    moveSpeed: 2.9,
    body: { height: 1.9, bodyColor: 0x3b3d44, limbColor: 0x2c2e34, accentColor: 0x8f2b2b },
  },
  {
    id: 'shenren',
    name: '神人',
    assetUrl: '/characters/protagonist/神人.ftx3.gz',
    dialogue: 'visitor_shenren',
    moveSpeed: 3.2,
    body: { height: 1.8, bodyColor: 0xc9a15f, limbColor: 0xa8834a, accentColor: 0x3f7a6a },
  },
];
