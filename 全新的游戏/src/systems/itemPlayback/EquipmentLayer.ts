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
// 配置：items.json 条目 combat.kind === 'equip'，参数 asset/slot/facing/offsetX/offsetY/scale。
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
  /** ★ 角色朝向限定：front=仅角色"前"（脸朝相机）时显示；back=仅"后"时显示。
   *   同时决定前后层深度：front 叠在角色之上（offsetZ 推向相机侧），
   *   back 位于角色后（负向 local Z，被角色深度遮挡，如背包/披风）。 */
  facing: 'front' | 'back';
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  scale: number;
}

/** ★ 配置读取：items.json 中 combat.kind==='equip' 的条目 → 视觉参数表 */
const equipVisuals = new Map<string, EquipVisual>();
for (const raw of (itemsConfig as { items: Array<Record<string, unknown>> }).items) {
  const combat = raw.combat as
    | { kind?: string; slot?: string; asset?: string; facing?: 'front' | 'back'; offsetX?: number; offsetY?: number; offsetZ?: number; scale?: number }
    | undefined;
  if (combat?.kind === 'equip' && typeof raw.id === 'string' && combat.asset) {
    const slot = (combat.slot ?? 'weapon') as EquipSlot;
    if (!EQUIP_SLOTS.includes(slot)) continue;
    equipVisuals.set(raw.id, {
      slot,
      asset: combat.asset,
      facing: combat.facing ?? 'front',
      offsetX: combat.offsetX ?? 0,
      offsetY: combat.offsetY ?? 0,
      offsetZ: combat.offsetZ ?? 0,
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
  /** ★ 按 itemId 索引（出击槽池内所有装备全量叠加；同部位多件均挂载） */
  private mounted = new Map<string, MountedEquip>();
  /** ★ 串行加载链：apply 并发调用排成一队，避免同一资产重复加载 */
  private chain: Promise<void> = Promise.resolve();
  /** ★ 已应用朝向缓存（仅在变化时刷显隐，避免每帧遍历） */
  private lastFacing: '前' | '后' | null = null;

  constructor(
    private scene: THREE.Scene,
    private host: THREE.Object3D,
    private getFacing: () => '前' | '后',
  ) {}

  /** ★ 按当前角色朝向刷新各挂载件的显隐（front↔'前' / back↔'后'） */
  private applyFacing(facing: '前' | '后'): void {
    for (const m of this.mounted.values()) {
      const ms = m.quad as unknown as { mesh?: THREE.Mesh | null };
      if (ms.mesh) ms.mesh.visible = (m.visual.facing === 'front' ? '前' : '后') === facing;
    }
  }

  /** ★ 按出击槽池同步装备贴片（全量叠加）：diff 出新增挂载、移除卸载，未变则跳过 */
  apply(items: string[]): Promise<void> {
    this.chain = this.chain.then(async () => {
      const wanted = new Map<string, EquipVisual>();
      for (const id of items) {
        if (!id) continue;
        const visual = getEquipVisual(id);
        if (visual) wanted.set(id, visual);
      }
      // 卸载已移除的
      for (const [id, m] of this.mounted) {
        if (!wanted.has(id)) {
          m.quad.dispose();
          this.mounted.delete(id);
        }
      }
      // 挂载新增的
      let depthIndex = 0;
      for (const [id, visual] of wanted) {
        if (this.mounted.has(id)) continue;
        try {
          await this.mount(id, visual, depthIndex++);
        } catch (err) {
          console.warn(`[EquipmentLayer] 装备 ${id} 挂载失败:`, err);
        }
      }
    });
    return this.chain;
  }

  private async mount(itemId: string, visual: EquipVisual, depthIndex = 0): Promise<void> {
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
    // ★ offsetZ 推向画面前方（父贴片朝相的局部 +Z）、与角色本体错开深度，
    //   避免与主角贴片共面 z-fighting；★ 叠加件按挂载次序再 ±depthIndex 微推：
    //   front 逐件朝相机前移、back 逐件远离相机后移，让"同部位多件全量叠加"
    //   不至于共面互相盖掉（层层错开）。back 层取负向 local Z = 角色后纹理
    //   （角色深度遮挡在后贴片之上 → 视觉上"在角色背后"）。
    const layeredZ = visual.facing === 'back'
      ? -visual.offsetZ - (depthIndex + 1) * 0.02
      : visual.offsetZ + depthIndex * 0.02;
    quad.setPosition(visual.offsetX, visual.offsetY, layeredZ);
    // 初始显隐按当前朝向生效（front↔'前' / back↔'后'）
    mesh.visible = (visual.facing === 'front' ? '前' : '后') === this.getFacing();
    this.mounted.set(itemId, {
      itemId,
      visual,
      quad,
      frameCount: asset.frameCount,
      fps: 4,
      t: 0,
    });
  }

  /** 每帧：推进贴片帧动画（只喂 uniforms，mesh 由场景自动渲染）；
   *   角色朝向变化时刷新前后纹理显隐（缓存防每帧遍历） */
  update(dt: number): void {
    for (const m of this.mounted.values()) {
      m.t += dt;
      const idx = Math.floor(m.t * m.fps) % m.frameCount;
      m.quad.render({ frameIndex: idx });
    }
    const facing = this.getFacing();
    if (facing !== this.lastFacing) {
      this.applyFacing(facing);
      this.lastFacing = facing;
    }
  }

  dispose(): void {
    for (const m of this.mounted.values()) m.quad.dispose();
    this.mounted.clear();
  }
}