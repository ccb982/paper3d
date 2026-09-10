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
// 配置：items.json 条目 combat.kind === 'equip'，参数 asset/slot/facing/offsetX/offsetY/scale/rotateZ。
// ============================================================

import * as THREE from 'three';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { FTXQuad } from '../../services/render/FTXQuad';
import { SilhouetteShadow } from '../../services/render/SilhouetteShadow';
import { renderManager } from '../../services/render/RenderManager';
import { RasterMap } from '../../services/map/RasterMap';
import { levelForDistance } from '../../services/lod';
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
  /** 贴片在画面前的平面内自旋（弧度；90°=横过来） */
  rotateZ: number;
}

/** ★ 配置读取：items.json 中 combat.kind==='equip' 的条目 → 视觉参数表 */
const equipVisuals = new Map<string, EquipVisual>();
for (const raw of (itemsConfig as { items: Array<Record<string, unknown>> }).items) {
  const combat = raw.combat as
    | { kind?: string; slot?: string; asset?: string; facing?: 'front' | 'back'; offsetX?: number; offsetY?: number; offsetZ?: number; scale?: number; rotateZ?: number }
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
      rotateZ: combat.rotateZ ?? 0,
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
  asset: FtxAsset;
  frameCount: number;
  fps: number;
  t: number;
  /** ★ 贴地剪影影子（首次获得帧数据时惰性创建；与角色同款太阳投影） */
  shadow: SilhouetteShadow | null;
  /** 剪影源包装（跨帧复用零分配；SilhouetteShadow 按 data 引用去重） */
  fd: { base: { width: number; height: number; data: Float32Array } } | null;
  worldPos: THREE.Vector3;
  worldScale: THREE.Vector3;
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
          m.shadow?.dispose();
          m.shadow = null;
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
    // ★ 平面内自旋（"横过来"）：绕贴片法线（局部 Z，画面前方向）旋转，
    //   继承父贴片 billboard 朝向 → 旋转始终发生在相机面内。
    mesh.rotation.z = visual.rotateZ;
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
      asset,
      frameCount: asset.frameCount,
      fps: 4,
      t: 0,
      shadow: null,
      fd: null,
      worldPos: new THREE.Vector3(),
      worldScale: new THREE.Vector3(),
    });
  }

  /**
   * ★ 装备贴片贴地影子（与角色同款机制）：太阳解析投影 + 逐顶点贴地，
   *   剪影随当前动画帧、翻转（父 scale 取反）通过世界 X 基自然镜像；
   *   世界高/宽取贴片世界缩放 → 影长 = 视觉高 × 投影比。
   */
  private updateShadow(m: MountedEquip, frameIndex: number, camera?: THREE.Camera): void {
    const ms = m.quad as unknown as { mesh?: THREE.Mesh | null };
    const mesh = ms.mesh;
    if (!mesh) return;
    const pair = m.asset.getFramePair(frameIndex);
    const img = pair?.base?.image as unknown as
      | { data?: Float32Array; width: number; height: number }
      | undefined;
    const raw = img?.data;
    if (!raw) {
      if (m.shadow) m.shadow.mesh.visible = false;
      return;
    }
    if (!m.fd) m.fd = { base: { width: 0, height: 0, data: raw } };
    m.fd.base.width = img!.width;
    m.fd.base.height = img!.height;
    m.fd.base.data = raw;
    if (!m.shadow) {
      mesh.updateWorldMatrix(true, false);
      m.worldScale.setFromMatrixScale(mesh.matrixWorld);
      // ★ 含平面内旋转（rotateZ）：横置贴片的屏幕宽 = 纹理高 × sinθ
      const th0 = m.visual.rotateZ;
      const w = Math.max(0.05, Math.hypot(
        Math.abs(m.worldScale.x) * Math.cos(th0),
        Math.abs(m.worldScale.y) * Math.sin(th0),
      ));
      m.shadow = new SilhouetteShadow(this.scene, w, 0.30);
    }
    m.shadow.setSource(m.fd);

    // ---- 太阳解析投影（与 EntityBase.syncShadow 同式） ----
    mesh.getWorldPosition(m.worldPos);
    const x = m.worldPos.x, y = m.worldPos.y, z = m.worldPos.z;
    const gy = RasterMap.current?.surfaceHeightAt(x, z) ?? 0;
    const airH = Math.max(0, y - gy);
    const sun = renderManager.querySun();
    const ux = -sun.dir.x, uz = -sun.dir.z;
    const ul = Math.hypot(ux, uz) || 1e-6;
    const sunUx = ux / ul, sunUz = uz / ul;
    const ratio = ul / Math.max(0.15, sun.dir.y);
    // 宽轴 = 贴片屏幕面内 X 轴（matrixWorld 列0/列1 按 rotateZ 合成）的地面投影
    //（含父级翻转镜像）；近共线日照时退化垂直
    const th = m.visual.rotateZ;
    const cth = Math.cos(th), sth = Math.sin(th);
    const e = mesh.matrixWorld.elements;
    let rx = e[0] * cth + e[4] * sth;
    let rz = e[2] * cth + e[6] * sth;
    const rl = Math.hypot(rx, rz);
    if (rl < 1e-4 || Math.abs((rx / rl) * sunUx + (rz / rl) * sunUz) > 0.98) {
      rx = -sunUz; rz = sunUx;
    } else {
      rx /= rl; rz /= rl;
    }
    // 视觉高同样按平面内旋转合成（横置时高 = 纹理宽方向）
    const worldH = Math.max(0.05, Math.hypot(
      Math.abs(m.worldScale.x) * sth,
      Math.abs(m.worldScale.y) * cth,
    ));
    const len = worldH * ratio;
    const ax = x + sunUx * airH * ratio;
    const az = z + sunUz * airH * ratio;
    m.shadow.followAffine(ax, az, rx, rz, sunUx, sunUz, len,
      (wx, wz) => RasterMap.current?.surfaceHeightAt(wx, wz) ?? 0);
    const dist = camera ? camera.position.distanceTo(m.worldPos) : 0;
    const lod = levelForDistance(dist);
    m.shadow.mesh.visible = mesh.visible && this.host.visible && lod < 3;
    m.shadow.setLodOpacity(lod, 0.2 + 0.8 * sun.daylight);
  }

  /** 每帧：推进贴片帧动画（只喂 uniforms，mesh 由场景自动渲染）；
   *   角色朝向变化时刷新前后纹理显隐（缓存防每帧遍历）；影子同步 */
  update(dt: number, camera?: THREE.Camera): void {
    for (const m of this.mounted.values()) {
      m.t += dt;
      const idx = Math.floor(m.t * m.fps) % m.frameCount;
      m.quad.render({ frameIndex: idx });
      this.updateShadow(m, idx, camera);
    }
    const facing = this.getFacing();
    if (facing !== this.lastFacing) {
      this.applyFacing(facing);
      this.lastFacing = facing;
    }
  }

  dispose(): void {
    for (const m of this.mounted.values()) {
      m.shadow?.dispose();
      m.quad.dispose();
    }
    this.mounted.clear();
  }
}