// ============================================================
// EquipmentLayer —— 装备贴片叠加（战斗道具播放 · 防具武器类）
// ============================================================
// 主角 = FTXQuad billboard 贴片。装备播放 = 在主角 mesh 上挂二级
// FTXQuad 子节点（weapon/armor/headgear 三锚点），子贴片只设局部
// 锚点偏移/缩放：
//   ★ 继承父贴片 billboard 朝向（无需自转）
//   ★ 继承父贴片翻转——父 scale 取反时子局部位置/缩放同步镜像
//   ★ 帧时间由本层独立推进（loop 全部帧）
// 不侵入播放器管线（子贴片叠加，非每帧纹理合成）。
// 配置：items.json 条目 combat.kind === 'equip'，参数 asset/slot/offsetX/offsetY/scale。
// ============================================================

import * as THREE from 'three';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { FTXQuad } from '../../services/render/FTXQuad';
import itemsConfig from '../../config/items.json';

export type EquipSlot = 'weapon' | 'armor' | 'headgear';
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor', 'headgear'];

export interface EquipVisual {
  slot: EquipSlot;
  asset: string;
  offsetX: number;
  offsetY: number;
  scale: number;
}

/** ★ 配置读取：items.json 中 combat.kind==='equip' 的条目 → 视觉参数表 */
const equipVisuals = new Map<string, EquipVisual>();
for (const raw of (itemsConfig as { items: Array<Record<string, unknown>> }).items) {
  const combat = raw.combat as
    | { kind?: string; slot?: string; asset?: string; offsetX?: number; offsetY?: number; scale?: number }
    | undefined;
  if (combat?.kind === 'equip' && typeof raw.id === 'string' && combat.asset) {
    const slot = (combat.slot ?? 'weapon') as EquipSlot;
    if (!EQUIP_SLOTS.includes(slot)) continue;
    equipVisuals.set(raw.id, {
      slot,
      asset: combat.asset,
      offsetX: combat.offsetX ?? 0,
      offsetY: combat.offsetY ?? 0,
      scale: combat.scale ?? 1.0,
    });
  }
}

/** 查询某装备道具的视觉配置（无则 null，跳过叠加） */
export function getEquipVisual(itemId: string): EquipVisual | null {
  return equipVisuals.get(itemId) ?? null;
}

interface MountedEquip {
  itemId: string;
  visual: EquipVisual;
  quad: FTXQuad;
  frameCount: number;
  fps: number;
  t: number;
}

export class EquipmentLayer {
  private slots = new Map<EquipSlot, MountedEquip>();
  /** ★ 串行加载链：apply 并发调用排成一队，避免同一资产重复加载 */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private scene: THREE.Scene,
    private host: THREE.Object3D,
  ) {}

  /** 按 session.player.equips 同步装备位（内部逐槽位 diff，不变则跳过） */
  apply(equips: { weapon?: string; armor?: string; headgear?: string }): Promise<void> {
    this.chain = this.chain.then(async () => {
      const current = equips ?? {};
      for (const slot of EQUIP_SLOTS) {
        const itemId = current[slot];
        const mounted = this.slots.get(slot);
        if (mounted && mounted.itemId === itemId) continue; // 未变化
        if (mounted) {
          mounted.quad.dispose();
          this.slots.delete(slot);
        }
        if (!itemId) continue;
        const visual = getEquipVisual(itemId);
        if (!visual) continue; // 该道具无装备视觉（配置缺失 → 跳过）
        try {
          await this.mount(slot, itemId, visual);
        } catch (err) {
          console.warn(`[EquipmentLayer] 装备 ${itemId} 挂载失败:`, err);
        }
      }
    });
    return this.chain;
  }

  private async mount(slot: EquipSlot, itemId: string, visual: EquipVisual): Promise<void> {
    const asset = await FtxAsset.load(encodeURI(visual.asset));
    const quad = new FTXQuad(this.scene, asset);
    // ★ 子贴片：移除出 scene 根，挂到主角 mesh（继承 billboard/翻转/变换）
    const mesh = (quad as unknown as { mesh: THREE.Mesh }).mesh;
    if (mesh) {
      this.scene.remove(mesh);
      this.host.add(mesh);
    }
    quad.setAnchorBottom(false);
    const frame0 = (asset.frames[0]?.bbox) as { w: number; h: number } | undefined;
    if (frame0) {
      quad.setFrameMapping({ width: frame0.w, height: frame0.h }, { x: 0, y: 0, w: frame0.w, h: frame0.h });
    }
    quad.setScaleKeepAspect(visual.scale);
    quad.setPosition(visual.offsetX, visual.offsetY, 0);
    this.slots.set(slot, {
      itemId,
      visual,
      quad,
      frameCount: asset.frameCount,
      fps: 4,
      t: 0,
    });
  }

  /** 每帧：推进贴片帧动画（只喂 uniforms，mesh 由场景自动渲染） */
  update(dt: number): void {
    for (const m of this.slots.values()) {
      m.t += dt;
      const idx = Math.floor(m.t * m.fps) % m.frameCount;
      m.quad.render({ frameIndex: idx });
    }
  }

  dispose(): void {
    for (const m of this.slots.values()) m.quad.dispose();
    this.slots.clear();
  }
}