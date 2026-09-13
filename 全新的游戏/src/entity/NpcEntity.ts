// ============================================================
// NpcEntity —— 事件 NPC（EntityBase 子类）
// ============================================================
// 探索期刷在区块内的可对话角色（幸存者/残响…）：
//   · 站桩贴片（FTXQuad billboard），无物理、无战斗、不参与伤害
//   · 交互半径内按 E 触发对话（WorldMode 统一判定/提示）
//   · 身份字段（npcId/name/dialogueTree/eventId）由事件系统注入
// ============================================================

import type * as THREE from 'three';
import { EntityBase } from './EntityBase';
import type { EntityManager } from './EntityManager';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import { FTXQuad } from '../services/render/FTXQuad';

export interface NpcOptions {
  x: number;
  y: number;
  z: number;
  npcId: string;
  name: string;
  /** 对话树 id（config/dialogues.json） */
  dialogue: string;
  /** 来源事件 id（对话结束 → 事件完成落账） */
  eventId?: string;
  /** 贴片世界宽（缺省与主角一致 2.0） */
  scale?: number;
}

export class NpcEntity extends EntityBase {
  readonly npcId: string;
  readonly displayName: string;
  readonly dialogueTree: string;
  readonly eventId: string | null;
  /** 交互半径（E 触发对话） */
  interactRadius = 3.2;

  constructor(em: EntityManager, scene: THREE.Scene, asset: FrameAssetSource, opts: NpcOptions) {
    super(em, { kind: 'npc', x: opts.x, y: opts.y, z: opts.z, asset });
    this.npcId = opts.npcId;
    this.displayName = opts.name;
    this.dialogueTree = opts.dialogue;
    this.eventId = opts.eventId ?? null;
    this.camp = 'neutral';
    this.physicsMode = 'none';
    this.attachToScene(scene);
    const scale = opts.scale ?? 2.0;
    if (this.renderer && 'setScaleKeepAspect' in this.renderer) {
      (this.renderer as { setScaleKeepAspect(s: number): void }).setScaleKeepAspect(scale);
    }
  }

  /** 影子（与角色同款竖立投影；NPC 站桩恒定） */
  protected override get shadowShape(): { w: number; h?: number; alpha?: number } | null {
    return { w: 1.1, h: 2.0, alpha: 0.3 };
  }

  protected createRenderer(scene: THREE.Scene): FTXQuad | null {
    if (!this.anim) return null;
    return new FTXQuad(scene, this.anim.source);
  }
}
