// ============================================================
// VehicleRide —— 载具乘骑（逻各斯的圆凳）
// ============================================================
// 唯一入口：setStats(stats)（装备统计的 vehicle / moveSpeedPct）。
// 装备载具时：
//   · 宿主贴片（及其全部装备贴片子节点）整体躺倒：平面内 roll，
//     中心精确抬到"凳面顶部 − 下压量"，角色下缘落在凳面上
//   · 宿主脚下绘制载具贴片（场景管理，不继承躺倒；billboard 跟随 + 贴地影子）
//   · 渲染保证：载具 renderOrder = -1 且不写深度；宿主 renderOrder = 1
//     → 正面/背面纹理、装备贴片永远盖在圆凳上
// 配置（items.json 该条目 combat）：asset / scale / offsetX / offsetY / offsetZ
// 调参（下方常量）：躺倒角度、下压量、接地量、视线让位
//
// 消费方：WorldMode（Player 的载具统计 + 爬坡/过坑）、BaseScene（基地内同表现 + 移速）
// ============================================================

import * as THREE from 'three';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { FTXQuad } from '../../services/render/FTXQuad';
import { SilhouetteShadow } from '../../services/render/SilhouetteShadow';
import { renderManager } from '../../services/render/RenderManager';
import { RasterMap } from '../../services/map/RasterMap';
import { levelForDistance } from '../../services/lod';
import itemsConfig from '../../config/items.json';

// ---- 可调参数（纯观感） ----
/** ① 平面内横倒角（度）：-90 = 头朝屏幕右横过来（侧躺基准） */
const LIE_ROLL_DEG = -90;
/** ② 侧躺下沉角（度）：绕身体纵轴贴向凳面；90 = 完全平躺，越小越立、越大越有透视深度
 *  ★ 调"维维美躺姿"改这里 */
const LIE_RECLINE_DEG = 75;
/** ③ 移动时整体抬高量（米）：骑行中的动态感（静止回落） */
const MOVE_LIFT = 0.15;
/** 移动判定速度阈值（m/s；实际位移速度） */
const MOVE_LIFT_MIN_SPEED = 0.3;
/** 身体底面离凳面的贴合余量（米） */
const LIE_PAD = 0.02;
/** 身体整体下压量（米）：越大越低（调"维维美高度"改这里） */
const LIE_SINK = 0.45;
/** 载具贴片下沉量（米）：贴图底部含透明边 → 略压入地面保证"接地"观感 */
const STOOL_GROUND_SINK = 0.11;
/** 载具贴片基础后让位（米）：与角色贴片共面防 z-fighting */
const STOOL_DEPTH_BACK = 0.08;
/** ★ 深度保证余量（米）：动态后让位使角色平面恒比凳面近该值 →
 *  角色（含背面纹理）永远盖住圆凳；圆凳照常写深度 → 水体等按深度正确遮挡 */
const STOOL_DEPTH_MARGIN = 0.06;
/** 后让位上限（米）：防止极端姿态下凳子被推离玩家（观感：凳子必须钉在玩家脚下） */
const STOOL_BACK_MAX = 0.3;
/** 影长/宽基准（与装备贴片同款） */
const SHADOW_ALPHA = 0.3;

// ---- 配置（items.json：stats.vehicle + combat.{asset,scale,offset*}） ----
interface VehicleVisual {
  asset: string;
  /** 贴片大小 = scale × 角色贴片世界宽（与装备贴片配置同量纲：相对角色大小） */
  scale: number;
  /** 载具贴片相对角色落点的偏移（世界米；offsetY 另加接地下沉） */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

/** 读取首个载具条目的视觉参数（无载具配置 → null，整层空转） */
function readVehicleVisual(): VehicleVisual | null {
  const items = (itemsConfig as { items: Array<Record<string, unknown>> }).items;
  for (const raw of items) {
    if (!(raw.stats as { vehicle?: boolean } | undefined)?.vehicle) continue;
    const c = (raw.combat ?? {}) as Record<string, number | string | undefined>;
    return {
      asset: String(c.asset ?? '/fx/圆凳.ftx3.gz'),
      scale: Number(c.scale ?? 1.0),
      offsetX: Number(c.offsetX ?? 0),
      offsetY: Number(c.offsetY ?? 0),
      offsetZ: Number(c.offsetZ ?? 0),
    };
  }
  return null;
}

const _dir = new THREE.Vector3(); // 视向让位临时向量
const _view = new THREE.Vector3(); // 视线临时向量

export class VehicleRide {
  private quad: FTXQuad | null = null;
  private active = false;
  private moveMul = 1;
  private loadToken = 0;
  private readonly visual = readVehicleVisual();
  private readonly _wp = new THREE.Vector3();
  /** 载具贴图高宽比（高/宽；加载后回填，用于精确算凳面高度） */
  private stoolAspect = 0;
  private shadow: SilhouetteShadow | null = null;
  private shadowSrc: { base: { width: number; height: number; data: Float32Array } } | null = null;
  /** 基础抬升 / 移动附加抬升（平滑；移动时整体抬高 MOVE_LIFT） */
  private baseLift = 0;
  private moveLift = 0;
  private readonly _prevPos = new THREE.Vector3();
  private hasPrevPos = false;

  constructor(
    private scene: THREE.Scene,
    /** 宿主贴片（角色/维维美）；躺倒姿态与跟随位置都取自它 */
    private hostQuad: FTXQuad,
    /** 角色贴片世界宽（= 躺倒后的竖向总高；基准尺寸） */
    private baseSize: number,
  ) {}

  // ============================================================
  // 状态（各模式统一入口）
  // ============================================================

  /** ★ 应用装备统计：乘骑开关 + 移速乘数（换装后调用；WorldMode / BaseScene 共用） */
  setStats(stats: { vehicle: boolean; moveSpeedPct: number }): void {
    this.moveMul = 1 + stats.moveSpeedPct;
    this.setActive(stats.vehicle);
  }

  /** 是否在骑乘 */
  get riding(): boolean {
    return this.active;
  }

  /** 移速乘数（1 = 无加成） */
  get moveSpeedMul(): number {
    return this.moveMul;
  }

  private setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    const mesh = this.hostQuad.meshObject;
    // ★ 宿主渲染序在载具（-1）之后：正面/背面纹理、装备贴片永远盖在圆凳上
    if (mesh) mesh.renderOrder = on ? 1 : 0;
    this.refreshPose();
    if (on) {
      if (this.quad) this.quad.setVisible(true);
      else void this.load();
    } else {
      this.quad?.setVisible(false);
    }
  }

  /** 侧躺姿态：横倒（侧躺感）+ 绕身体纵轴下沉贴向凳面（透视深度），中心精确抬到凳面之上 */
  private refreshPose(): void {
    if (!this.active) {
      this.hostQuad.setRoll(0);
      this.hostQuad.setLie(0);
      this.hostQuad.setAnchorLift(null);
      this.moveLift = 0;
      this.hasPrevPos = false;
      return;
    }
    const recline = -THREE.MathUtils.degToRad(LIE_RECLINE_DEG);
    // 下沉后贴片的竖向半高 = 贴片世界宽 × |cos(下沉角)| / 2（完全平躺时 = 0）
    const halfV = Math.abs(this.hostQuad.meshObject?.scale.x ?? this.baseSize) * Math.abs(Math.cos(recline)) / 2;
    this.baseLift = this.stoolTopRelY() + halfV + LIE_PAD - LIE_SINK;
    this.hostQuad.setRoll(THREE.MathUtils.degToRad(LIE_ROLL_DEG));
    this.hostQuad.setLie(recline);
    this.hostQuad.setAnchorLift(this.baseLift + this.moveLift);
  }

  /** 凳面顶部相对地面高（世界米） */
  private stoolTopRelY(): number {
    const v = this.visual;
    if (!v) return 0;
    return v.offsetY - STOOL_GROUND_SINK + v.scale * this.baseSize * this.stoolAspect;
  }

  // ============================================================
  // 载具贴片
  // ============================================================

  private async load(): Promise<void> {
    const v = this.visual;
    if (!v) return;
    const token = ++this.loadToken;
    const asset = await FtxAsset.load(encodeURI(v.asset));
    if (token !== this.loadToken) return; // 过期加载丢弃（开关已翻转/销毁）

    const quad = new FTXQuad(this.scene, asset);
    const frame0 = asset.frames[0]?.bbox as { w: number; h: number } | undefined;
    if (frame0) {
      quad.setFrameMapping({ width: frame0.w, height: frame0.h }, { x: 0, y: 0, w: frame0.w, h: frame0.h });
      quad.render({ frameIndex: 0 });
      this.stoolAspect = frame0.h / Math.max(1, frame0.w);
    }
    quad.setAnchorBottom(true); // 底部锚点：凳子"站"在地面上
    quad.setScaleKeepAspect(v.scale * this.baseSize);
    quad.setVisible(this.active);
    // 写深度：水体/其它透明物按深度正确遮挡圆凳（角色恒盖由动态后让位保证，见 update）
    const mesh = quad.meshObject;
    if (mesh) mesh.renderOrder = -1; // 先于角色绘制
    this.quad = quad;

    // 贴地剪影影子（贴图 alpha 剪影源；与装备贴片同款）
    const img = asset.getFramePair(0)?.base?.image as unknown as
      | { data?: Float32Array; width: number; height: number }
      | undefined;
    if (img?.data) {
      this.shadowSrc = { base: { width: img.width, height: img.height, data: img.data } };
      this.shadow = new SilhouetteShadow(this.scene, v.scale * this.baseSize, SHADOW_ALPHA);
    }
    this.refreshPose(); // 贴图比例已知 → 重算躺乘高度（精确坐落在凳面）
  }

  /** 每帧：载具贴片跟随宿主落点 + billboard + 影子（宿主隐藏时一起隐藏） */
  update(dt: number, camera?: THREE.Camera): void {
    const q = this.quad;
    const v = this.visual;
    const host = this.hostQuad.meshObject;
    if (!q || !v || !host || !this.active) return;
    q.setVisible(host.visible); // 航行操船等宿主隐藏时载具连影子一起隐藏
    if (!host.visible) {
      if (this.shadow) this.shadow.mesh.visible = false;
      return;
    }

    host.getWorldPosition(this._wp);
    // ★ 移动时整体抬高（骑行感；按实际位移速度判定 + 平滑升降）
    const speed = this.hasPrevPos && dt > 1e-3
      ? Math.hypot(this._wp.x - this._prevPos.x, this._wp.z - this._prevPos.z) / dt
      : 0;
    this._prevPos.copy(this._wp);
    this.hasPrevPos = true;
    const targetLift = speed > MOVE_LIFT_MIN_SPEED ? MOVE_LIFT : 0;
    this.moveLift += (targetLift - this.moveLift) * Math.min(1, dt * 8);
    this.hostQuad.setAnchorLift(this.baseLift + this.moveLift);
    const gy = RasterMap.current?.surfaceHeightAt(this._wp.x, this._wp.z) ?? 0;
    const stoolY = gy + v.offsetY - STOOL_GROUND_SINK;
    // ★ 沿视线向后让位（动态）：保证角色平面恒比凳面近 STOOL_DEPTH_MARGIN，
    //   体位再低/相机再俯，角色（含背面纹理）也永远盖住圆凳
    let bx = 0, bz = 0;
    if (camera) {
      _view.subVectors(camera.position, this._wp);
      const vlen = _view.length() || 1;
      const vx = _view.x / vlen, vy = _view.y / vlen, vz = _view.z / vlen;
      const hxz = Math.hypot(vx, vz);
      _dir.subVectors(camera.position, this._wp);
      _dir.y = 0;
      if (_dir.lengthSq() > 1e-8 && hxz > 0.15) {
        // 后让位需求 = (余量 + 凳面中心相对角色中心的视线深度) / 水平视向分量。
        // ★ 凳面中心在角色中心之下（常态）→ 需求为负 → 只留基础让位（钉子般贴在玩家脚下）；
        //   仅角色被压到凳面中心之下时才拉开距离，且封顶 STOOL_BACK_MAX
        const stoolCy = stoolY + v.scale * this.baseSize * this.stoolAspect / 2;
        const need = (STOOL_DEPTH_MARGIN + (stoolCy - this._wp.y) * vy) / hxz;
        const back = Math.min(STOOL_BACK_MAX, Math.max(STOOL_DEPTH_BACK, need));
        _dir.normalize().multiplyScalar(-back);
        bx = _dir.x;
        bz = _dir.z;
      }
    }
    q.setPosition(
      this._wp.x + v.offsetX + bx,
      stoolY,
      this._wp.z + v.offsetZ + bz,
    );
    if (camera) q.setBillboard(camera);
    this.updateShadow(camera);
  }

  /** 载具贴地剪影影子（太阳解析投影 + 逐顶点贴地；与装备贴片同款机制） */
  private updateShadow(camera?: THREE.Camera): void {
    const mesh = this.quad?.meshObject;
    const sh = this.shadow;
    const src = this.shadowSrc;
    if (!mesh || !sh || !src) return;
    sh.setSource(src);
    mesh.getWorldPosition(this._wp);
    const x = this._wp.x, y = this._wp.y, z = this._wp.z;
    const gy = RasterMap.current?.surfaceHeightAt(x, z) ?? 0;
    const airH = Math.max(0, y - gy);
    const sun = renderManager.querySun();
    const ux = -sun.dir.x, uz = -sun.dir.z;
    const ul = Math.hypot(ux, uz) || 1e-6;
    const sunUx = ux / ul, sunUz = uz / ul;
    const ratio = ul / Math.max(0.15, sun.dir.y);
    // 贴片面内 X 轴（无 roll）在世界地面上的投影方向
    const e = mesh.matrixWorld.elements;
    let rx = e[0], rz = e[2];
    const rl = Math.hypot(rx, rz);
    if (rl < 1e-4 || Math.abs((rx / rl) * sunUx + (rz / rl) * sunUz) > 0.98) {
      rx = -sunUz; rz = sunUx;
    } else {
      rx /= rl; rz /= rl;
    }
    const len = Math.max(0.05, Math.abs(mesh.scale.y || 0.6)) * ratio;
    sh.followAffine(
      x + sunUx * airH * ratio,
      z + sunUz * airH * ratio,
      rx, rz, sunUx, sunUz, len,
      (wx, wz) => RasterMap.current?.surfaceHeightAt(wx, wz) ?? 0,
    );
    const lod = camera ? levelForDistance(camera.position.distanceTo(this._wp)) : 0;
    sh.mesh.visible = mesh.visible && lod < 3;
    sh.setLodOpacity(lod, 0.2 + 0.8 * sun.daylight);
  }

  dispose(): void {
    this.loadToken++;
    this.shadow?.dispose();
    this.shadow = null;
    this.shadowSrc = null;
    this.quad?.dispose();
    this.quad = null;
    const mesh = this.hostQuad.meshObject;
    if (mesh) mesh.renderOrder = 0;
    this.hostQuad.setRoll(0);
    this.hostQuad.setAnchorLift(null);
  }
}
