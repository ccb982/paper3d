// ============================================================
// VehicleRide —— 载具乘骑播放（圆凳）
// ============================================================
// 装备载具（items.json 条目 stats.vehicle === true）时：
//   · 主角贴片 + 身上全部装备贴片整体躺倒
//     （宿主 mesh 平面内 roll；装备贴片是宿主子节点 → 随姿态一起转）
//   · 宿主脚下绘制载具贴片（场景管理，不继承躺倒，独立 billboard 跟随）
// 视觉参数：items.json 该条目 combat.{asset,scale,offsetX,offsetY,offsetZ}；
//   姿态常量（roll 角度 / 中心抬升）在下方，按实机观感调。
// ============================================================

import * as THREE from 'three';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { FTXQuad } from '../../services/render/FTXQuad';
import { RasterMap } from '../../services/map/RasterMap';
import itemsConfig from '../../config/items.json';

/** 躺倒姿态：绕贴片法线的平面内滚转（-90° = 头朝屏幕左躺下） */
const RIDE_ROLL = -Math.PI / 2;
/** 躺倒后贴片中心离地高（世界米）——身体贴在凳面上的高度 */
const RIDE_CENTER_LIFT = 0.55;

interface VehicleVisual {
  asset: string;
  /** 贴片大小 = scale × 角色身高（与装备贴片配置同量纲：相对角色大小） */
  scale: number;
  /** 载具贴片相对宿主落点的偏移（世界米） */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

/** 配置读取：items.json 首个 stats.vehicle 条目 → 载具贴片参数 */
function firstVehicleVisual(): VehicleVisual | null {
  const items = (itemsConfig as { items: Array<Record<string, unknown>> }).items;
  for (const raw of items) {
    const stats = raw.stats as { vehicle?: boolean } | undefined;
    if (!stats?.vehicle) continue;
    const combat = (raw.combat ?? {}) as {
      asset?: string;
      scale?: number;
      offsetX?: number;
      offsetY?: number;
      offsetZ?: number;
    };
    return {
      asset: combat.asset ?? '/fx/圆凳.ftx3.gz',
      scale: combat.scale ?? 1.0,
      offsetX: combat.offsetX ?? 0,
      offsetY: combat.offsetY ?? 0,
      offsetZ: combat.offsetZ ?? 0,
    };
  }
  return null;
}

export class VehicleRide {
  private quad: FTXQuad | null = null;
  private active = false;
  private loadToken = 0;
  private readonly visual = firstVehicleVisual();
  private readonly _wp = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private host: THREE.Object3D,
    private hostQuad: FTXQuad,
    /** 角色贴片世界高（基准：贴片大小 = visual.scale × 该值） */
    private baseSize: number,
  ) {}

  /** 乘骑开关（装备状态变化时调用；idempotent） */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    // ① 宿主躺倒姿态（世界/基地通用：中心抬到凳面高 + 平面内 roll）
    this.hostQuad.setRoll(on ? RIDE_ROLL : 0);
    this.hostQuad.setAnchorLift(on ? RIDE_CENTER_LIFT : null);
    // ② 载具贴片显隐/加载
    if (on) {
      if (this.quad) this.quad.setVisible(true);
      else void this.load();
    } else {
      this.quad?.setVisible(false);
    }
  }

  /** 当前是否在骑乘（读取用） */
  get riding(): boolean {
    return this.active;
  }

  private async load(): Promise<void> {
    if (!this.visual) return;
    const token = ++this.loadToken;
    const asset = await FtxAsset.load(encodeURI(this.visual.asset));
    if (token !== this.loadToken) return; // 过期加载丢弃（开关已翻转）
    const quad = new FTXQuad(this.scene, asset);
    const frame0 = asset.frames[0]?.bbox as { w: number; h: number } | undefined;
    if (frame0) {
      quad.setFrameMapping({ width: frame0.w, height: frame0.h }, { x: 0, y: 0, w: frame0.w, h: frame0.h });
      quad.render({ frameIndex: 0 });
    }
    quad.setAnchorBottom(false);
    quad.setScaleKeepAspect(this.visual.scale * this.baseSize);
    quad.setVisible(this.active);
    this.quad = quad;
  }

  /** 每帧：载具贴片跟随宿主落点（贴地）+ billboard（相机旋转时贴片始终正对） */
  update(_dt: number, camera?: THREE.Camera): void {
    const q = this.quad;
    const v = this.visual;
    if (!q || !v || !this.active) return;
    // ★ 宿主隐藏（航行操船等）时载具一起隐藏
    q.setVisible(this.host.visible);
    if (!this.host.visible) return;
    this.host.getWorldPosition(this._wp);
    const gy = RasterMap.current?.surfaceHeightAt(this._wp.x, this._wp.z) ?? 0;
    q.setPosition(
      this._wp.x + v.offsetX,
      gy + v.offsetY,
      this._wp.z + v.offsetZ,
    );
    if (camera) q.setBillboard(camera);
  }

  dispose(): void {
    this.loadToken++;
    this.quad?.dispose();
    this.quad = null;
    this.hostQuad.setRoll(0);
    this.hostQuad.setAnchorLift(null);
  }
}
