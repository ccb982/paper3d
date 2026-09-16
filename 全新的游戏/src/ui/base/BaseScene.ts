// ============================================================
// BaseScene —— 基地内部 3D 剖切空间（2026-09-12 二版：三间打通 + 角色行走）
// ============================================================
// 用户定调：
//   · 手绘标注是 **3D 示意图**——按它搭"真正的一块空间"（地板/背墙/天花板/侧壁，
//     正面敞开 = 剖切面）；**三个房间打通**成一间大厅（只留分界立柱/顶梁）；
//   · **维维美（主角）在里面**：WASD/方向键在大厅内行走（立绘 + 走/待机帧动画）；
//   · **镜头跟随维维美**：平滑跟随；**滚轮缩放视野**（改跟随机距）；
//   · 原来的页面按钮（MainButtons）保持不变；基地不绘制战机。
// 生命周期：BaseMode.enter 创建、exit dispose（几何/材质/贴图/监听全清）。

import * as THREE from 'three';
import { FTXQuad } from '../../services/render/FTXQuad';
import { DroneCompositeRender } from '../../services/render/DroneCompositeRender';
import { FrameAnimatorBase } from '../../services/fx/FrameAnimatorBase';
import type { CharacterFxAssetSource, FrameAssetSource } from '../../services/fx/AssetSource';
import { EquipmentLayer } from '../../systems/itemPlayback/EquipmentLayer';
import { VehicleRide } from '../../systems/itemPlayback/VehicleRide';
import type { ItemManager } from '../../systems/inventory/ItemManager';
import { loadFtxCached } from '../../services/fx/FtxAssetCache';
import { VisitorBodyRenderer, type VisitorBodyStyle } from '../../services/render/VisitorBodyRenderer';
import { VisitorModelRenderer, type VisitorModelStyle } from '../../services/render/VisitorModelRenderer';
import type { VisitorBodyLike } from '../../services/render/VisitorBodyLike';
import baseRooms from '../../config/baseRooms.json';
// ★ 2026-09-16：房间不再用 Box+MeshStandardMaterial 硬搭，改由
//   RoomDeco（手搓顶点布局）+ RoomSurfaceMaterial（程序化表面 shader）接管。
//   房间尺寸常量也一并搬到 RoomDeco 里做唯一事实来源，这里 import 回来。
import {
  DOOR_H, DOOR_HALF, ROOM_D, ROOM_GAP, ROOM_H, ROOM_W, WALL_T,
  createDecorMats, createPadMaterialFor, decorateControl, decorateCockpit,
  decorateShell, decorateStorage, decorateWorkshop, updateRoomTime,
  type AddFn, type DecorMats, type RegisterAnim, type RegisterClick, type RegisterKinetic,
} from './RoomDecor';
import { chamferRectProfile, extrudeProfile, wedgeProfile } from '../../services/render/RoomDecoGeo';
import { createSpaceBackdrop, spinDome, type SpaceBackdrop } from '../../services/render/SpaceBackdrop';
import { RoomPhysics, type KineticMover } from '../../services/physics/RoomPhysics';

export interface RoomDef {
  id: string;
  name: string;
  kind: string;
  label: string;
}

/** ★ 交互站（E / F 触发）：本地大厅坐标 + 触发范围（xz 半宽；1e9 = 不限） */
export interface BaseStation {
  x: number;
  z: number;
  rx: number;
  rz: number;
  label: string;
  cb: () => void;
  /** ★ 跟随访客身体索引（0-based，对应 setEventBodies 顺序）：站位随 NPC 走动同步 */
  followBodyIndex?: number;
}

/** ★ 彩蛋门槛：地球自转多少圈后普瑞赛斯登场。
 *  30 圈 ≈ 7 分钟（地球自转 0.45 rad/s ≈ 14 秒一圈；见 SpaceBackdrop.EARTH_SPIN）。 */
const PRIESTESS_TURNS = 30;

/** 普瑞赛斯立绘的位置与大小
 *  坐标是"脚底锚点"——setPosition 会按当前高度自动把中心抬到 y + H/2，
 *  所以**每帧设完缩放后必须重新 setPosition**（否则缩放变化时锚点不跟随）。
 *  可见窗口：地板前缘(28.9°) ~ 屏幕下沿(41.8°) 之间那条扁带（约 11 单位高）。 */
const PRIESTESS_X = 0;
const PRIESTESS_Y = -128;  // 脚底；立绘顶 = -128 + H = -8 → 只有头部落进可见窗口
// ★ 深度必须**始终在地球之上**（地球球心 (0,-38,-35)、r=26 → 最前表面 z≈-9）。
//   做法：立绘**关闭深度测试**（setDepthTest(false)）——
//   位置固定不跟随镜头，billboard 随镜头转（和原先一样）；
//   但因为不读深度缓冲，无论怎么转都不会被地球/任何几何切掉。
//   同时 setDepthWrite(false)：纯叠加层，不干扰其它透明物体排序。
const PRIESTESS_Z = -4;
const PRIESTESS_H = 120;   // 立绘**高**（世界单位）

/** ★ 实体碰撞半径（角色 / 访客；圆形近似） */
const CHAR_R = 0.55;
const NPC_R = 0.42;

/** 角色参数（2026-09-12 用户定调：可跳跃、移速加快；房间 3× 后再提一档） */
const MOVE_SPEED = 9.5;
const JUMP_V = 7.2;
const GRAVITY = 20;

/** ★ 交互站地面光圈（x/z 本地大厅坐标；label 与站点一致 → 进区时光圈收紧变亮） */
export interface StationPadSpec {
  x: number;
  z: number;
  color: number;
  radius?: number;
  label: string;
}

export interface BaseSceneOptions {
  /** 房间定义（缺省 = 基地三间；舰内 = [shipRoom]） */
  rooms?: RoomDef[];
  /** 主角立绘（维维美） */
  protagonistAsset?: FrameAssetSource;
  /** 盟友立绘素材（无人机；祖宗为弹药消耗品不再绘制） */
  droneAsset?: FrameAssetSource;
  /** 出击槽读取（装备贴片 / 盟友跟随） */
  itemManager?: ItemManager;
  /** WebGL 渲染器（无人机三帧合成 + 翅膀 VAT 离屏烘焙共享上下文用） */
  renderer?: THREE.WebGLRenderer;
  /** ★ 舷外空间背景（星空天穹 + 自转地球；基地 true，舰内 false 保持灰底） */
  spaceBackdrop?: boolean;
  /** ★ 普瑞赛斯素材（彩蛋：地球转满 100 圈 → 出现在地球上） */
  bossAsset?: FrameAssetSource;
}

export class BaseScene {
  private sceneRef: THREE.Scene;
  /** 主渲染器（无人机翅膀 VAT 离屏烘焙共享上下文） */
  private renderer3d: THREE.WebGLRenderer | null = null;
  private root: THREE.Group;
  private hallW: number;
  private bays: number[] = [];
  /** ★ 房间材质集合（shader；由 buildHall 创建，dispose 时随 root 遍历回收） */
  private mats: DecorMats | null = null;
  /** ★ 交互站地面光圈（label 与站点对应；进区 → uActive=1） */
  private pads: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; label: string }[] = [];

  /** 通用时钟（盟友绕行/呼吸等周期动画用） */
  private t = 0;
  /** ★ 房间可动元素（传送带/机械臂/行车/全息…）：装饰期注册，每帧统一驱动 */
  private roomAnims: ((t: number, dt: number) => void)[] = [];
  /** ★ 实体碰撞体（2026-09-16 用户定调：基地/舰内**所有实体都要有物理体积**）
   *  收集体：房间建好后遍历 root 自动生成（xz 平面 AABB，人走路的圆去撞）
   *  过滤：只收"人走会撞到的高度区间"（0.35 ~ 1.6m）、排除薄片/小零件/
   *  灯带屏幕等装饰材质、以及标记了 userData.noSolid 的会动道具。 */
  private solids: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  /** ★ 可推家具物理（rapier；家具被推走后 solids 每帧跟着刷新） */
  private roomPhys: RoomPhysics | null = null;
  /** ★ 运动学道具（AGV 小车 / 行车吊箱）：动画位置 → 物理刚体 */
  private kineticMovers: KineticMover[] = [];
  /** ★ 可点击目标（房间彩蛋：双击命中 → 回调） */
  private clickTargets: { mesh: THREE.Object3D; cb: () => void }[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  /** ★ 舷外空间背景（星空 + 地球；基地才有） */
  private backdrop: SpaceBackdrop | null = null;
  /** ★ 彩蛋：地球转满 100 圈 → 普瑞赛思登场 */
  private priestess: FTXQuad | null = null;
  private priestessFrame = 0;   // 静态帧索引（'前'）
  private priestessAspect = 1.4; // 立绘宽高比（h/w；用素材帧数据算，兜底 1.4）
  private priestessAt = 0;      // 触发时刻（0 = 还没触发）
  /** 已经数过的圈数（每帧从 t 重算，避免浮点漂移累积） */
  private earthTurns = 0;

  // ---- 角色（维维美） ----
  private quad: FTXQuad | null = null;
  private anim: FrameAnimatorBase | null = null;
  /** 出生点：仓库间中区空地（避开货箱矩阵；有实体碰撞后必须选空位，否则开局被顶） */
  private charPos = new THREE.Vector3(0, 0, 4.0);
  private facingRight = true;
  private moving = false;
  private wasMoving = false;
  private keys = new Set<string>();
  /** 跳跃（空格）：高度/竖直速度/是否着地 */
  private charY = 0;
  private vy = 0;
  private grounded = true;
  private wantJump = false;

  // ---- 交互站（F 触发；基地 = 加工站 + 事件角色，舰内 = 事件角色 + 按钮条） ----
  /** 加工站房间的本地 x（onCraftStation 默认站点用） */
  private craftBayX: number | null = null;
  /** 加工站回调（与事件站点合并进交互站列表） */
  private craftCb: (() => void) | null = null;
  /** ★ 事件站点（对话/事件模块注入：BaseMode/WorldMode 装配） */
  private eventStations: BaseStation[] = [];
  private stations: BaseStation[] = [];
  private activeStation: BaseStation | null = null;
  /** ★ 事件 NPC 立绘（固定位贴片；setEventNpcs 全量替换） */
  private npcQuads: FTXQuad[] = [];
  /** ★ 访客程序化身体（舰内：圆润 Q 版小人 + 脸部纹理；setEventBodies 全量替换）。
   *  在家附近自动游荡（走 → 停 → 再走），停下时面向维维美 + 待机小动作。 */
  private eventBodies: {
    body: VisitorBodyLike;
    x: number; z: number;
    homeX: number; homeZ: number;
    targetX: number; targetZ: number;
    walking: boolean;
    speed: number;
    /** 当前状态剩余时间（走→驻足 / 驻足→起步） */
    timer: number;
  }[] = [];
  /** ★ NPC 立绘异步装载令牌（防过期加载回写） */
  private npcLoadToken = 0;
  private promptEl: HTMLDivElement;
  /** 提示是否已显示（与 inCraftZone 分开：UI 打开时要临时隐藏） */
  private promptShown = false;
  /** ★ 交互按键名（小写，与 KeyboardEvent.key.toLowerCase() 对齐；显示时转大写） */
  private promptKey = 'f';
  /** ★ UI 遮挡判定（面板/覆盖层打开 → 隐藏加工台提示并禁用 F；BaseMode 注入） */
  private uiBlocking: (() => boolean) | null = null;

  // ---- 身上的各种图标（装备贴片）与盟友跟随 ----
  //   无人机 = DroneCompositeRender（★ 三帧叠加合成：主体 + 左翼 + 右翼，与游戏内同管线）
  //   祖宗是弹药消耗品 → 基地内不绘制
  private equip: EquipmentLayer | null = null;
  private droneAllies: { view: DroneCompositeRender; anim: FrameAnimatorBase; index: number }[] = [];
  private droneAssetSrc: FrameAssetSource | null = null;
  private itemManagerRef: ItemManager | null = null;
  /** ★ 载具乘骑（逻各斯的圆凳）：姿态 + 移速乘数（换装时 setStats 刷新） */
  private vehicleRide: VehicleRide | null = null;

  // ---- 相机（跟随 + 缩放） ----
  private camera: THREE.PerspectiveCamera | null = null;
  private camPos = new THREE.Vector3(0, 8.8, 24);
  private camDist = 24;
  private camDistTarget = 24;

  constructor(scene: THREE.Scene, opts: BaseSceneOptions = {}) {
    this.sceneRef = scene;
    this.renderer3d = opts.renderer ?? null;
    this.root = new THREE.Group();
    scene.add(this.root);

    // ★ 舷外空间背景：星空 + 自转地球（只基地开；舰内保持灰底）
    if (opts.spaceBackdrop) {
      const backdrop = createSpaceBackdrop(scene, {
        pixelRatio: this.renderer3d?.getPixelRatio() ?? 1,
      });
      this.backdrop = backdrop;
      this.root.add(backdrop.dome, backdrop.earth, backdrop.stars);
      this.roomAnims.push((t, dt) => {
        // 整片星空缓慢自转（"不停的动"）；地球自转在 shader 里靠共享时钟驱动
        spinDome(backdrop, dt);
        // 地球已转圈数（JS 用与 shader 相同的 EARTH_SPIN 常数换算）
        this.earthTurns = (t * backdrop.spin) / (Math.PI * 2);
        this.updatePriestess(t, dt);
      });

      // ★ 彩蛋：地球转满 N 圈 → 普瑞赛斯的脸出现在星球上（立绘从 0 弹性放大）
      //   定位要点（踩过的坑）：
      //     a) 必须在地球球体**前表面之外**（球心 (0,-38,-35)、r=26 → 前表面 z≈-9），
      //        否则立绘被地球自己挡住 → 完全看不见；
      //     b) 必须在地板前缘的遮挡线之下才可见：
      //        可见判据 y < 8.8 - 0.55 × (25 - z)（相机 (0,8.8,25)，地板前缘 z=9,y=0）；
      //     c) 可见"窗口"很扁（约 11 单位高）→ 把立绘做得很大、只让**头部**落在窗口里，
      //        看起来就是"一张脸贴在星球地平线上"。
      const bossAsset = opts.bossAsset;
      if (bossAsset) {
        this.priestess = new FTXQuad(this.sceneRef, bossAsset);
        // ★ 始终压在地球之上（不读深度缓冲 → 不可能被星球切掉）
        this.priestess.setDepthTest(false);
        this.priestess.setDepthWrite(false);
        this.priestess.setAnchorBottom(true);
        this.priestess.setScale(0.001, 0.001);
        this.priestess.setPosition(PRIESTESS_X, PRIESTESS_Y, PRIESTESS_Z);
        this.priestess.setVisible(false);
        // 静态一帧（普瑞赛斯素材的正面帧；不用逐帧动画，避免帧名不匹配时空白）
        this.priestessFrame = bossAsset.resolveFrame('前') ?? 0;
        // 纹理宽高比（保持立绘比例：只按"高"给尺寸，宽按比例折算）
        const src = bossAsset as unknown as {
          getFtxFrame?: (i: number) => { width?: number; height?: number } | null;
        };
        const f = src.getFtxFrame?.(this.priestessFrame) ?? null;
        this.priestessAspect = f && f.width && f.height ? f.height / f.width : 1.4;
      }
    }

    // 环境光（冷顶光 + 极淡暖补 + 相机侧正面补光；2026-09-16 极简版：
    //   大面积表面由 RoomSurfaceMaterial 自己烘焙光照，这里只负责角色/NPC/绿植等实体）
    const hemi = new THREE.HemisphereLight(0xbcd0e0, 0x2a3540, 0.95);
    const key = new THREE.DirectionalLight(0xe4eef8, 0.85);
    key.position.set(-6, 10, 8);
    const warm = new THREE.DirectionalLight(0xffd9a8, 0.16);
    warm.position.set(7, 4, 6);
    const fill = new THREE.DirectionalLight(0xc8d8e6, 0.28);
    fill.position.set(0, 6, 18);
    this.root.add(hemi, key, warm, fill);

    const defs = (opts.rooms ?? (baseRooms.rooms as RoomDef[]));
    this.hallW = defs.length * ROOM_W + (defs.length - 1) * ROOM_GAP;
    for (let i = 0; i < defs.length; i++) {
      this.bays.push((i - (defs.length - 1) / 2) * (ROOM_W + ROOM_GAP));
    }
    this.buildHall(defs);

    // 角色（无素材时跳过，仅保留空间）
    const protagonistAsset = opts.protagonistAsset;
    if (protagonistAsset) {
      this.quad = new FTXQuad(scene, protagonistAsset);
      this.quad.setScaleKeepAspect(2.4);
      this.quad.setAnchorBottom(true);
      this.quad.setPosition(this.charPos.x, 0, this.charPos.z);
      this.anim = new FrameAnimatorBase(protagonistAsset);
      this.anim.playFrames(['前0', '前1'], { fps: 2, loop: true });

      // ★ 身上的各种图标（装备贴片）：按出击槽全量叠加（武器/防具/头饰，
      //   如黍姐的XX、鱼生萌萌香），与游戏内 EquipmentLayer 同一管线
      this.droneAssetSrc = opts.droneAsset ?? null;
      this.itemManagerRef = opts.itemManager ?? null;
      const slots = this.currentSlots();
      const hostMesh = (this.quad as unknown as { mesh?: THREE.Mesh | null }).mesh ?? null;
      if (hostMesh) {
        this.equip = new EquipmentLayer(scene, hostMesh, () => '前');
        void this.equip.apply(slots);
        // ★ 载具乘骑（逻各斯的圆凳）：基地内与游戏内同一套表现
        this.vehicleRide = new VehicleRide(scene, this.quad, 2.4);
      }
      this.syncDroneAlly(slots);
      this.syncVehicle();
    }

    // 交互站提示条（靠近站点时显示；极简配色：深底 + 发丝边 + 冷色文本）
    this.promptEl = document.createElement('div');
    this.promptEl.style.cssText =
      'position:fixed;left:50%;bottom:16%;transform:translateX(-50%);display:none;'
      + 'color:#e8eef4;background:rgba(12,15,19,0.82);border:1px solid rgba(150,185,210,0.35);'
      + 'padding:6px 16px;border-radius:6px;font:14px "Microsoft YaHei",sans-serif;'
      + 'letter-spacing:0.06em;z-index:600;pointer-events:none;white-space:pre';
    this.promptEl.textContent = this.promptKey.toUpperCase();
    document.body.appendChild(this.promptEl);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('dblclick', this.onDblClick);
    window.addEventListener('click', this.onClick);
  }

  /** ★ 交互站列表（F 触发；本地大厅坐标） */
  setStations(stations: BaseStation[]): void {
    this.stations = stations;
    this.activeStation = null;
  }

  /** 加工站交互回调（BaseMode 注入：打开加工台覆盖层） */
  onCraftStation(cb: () => void): void {
    this.craftCb = cb;
    this.rebuildStations();
  }

  /** ★ 事件站点（对话/事件模块注入；与加工站合并） */
  setEventStations(list: BaseStation[]): void {
    this.eventStations = list;
    this.rebuildStations();
  }

  /** ★ 事件 NPC 立绘（固定位；与站点同源注入。assetUrl 为空 = 不绘制贴片） */
  setEventNpcs(list: { x: number; z: number; assetUrl?: string }[]): void {
    const token = ++this.npcLoadToken;
    for (const q of this.npcQuads) q.dispose();
    this.npcQuads = [];
    for (const npc of list) {
      if (!npc.assetUrl) continue;
      void loadFtxCached(npc.assetUrl)
        .then((asset) => {
          if (token !== this.npcLoadToken) return; // 已过期（场景重建/列表更新）
          const q = new FTXQuad(this.sceneRef, asset);
          q.setScaleKeepAspect(2.4);
          q.setAnchorBottom(true);
          q.setPosition(npc.x, 0, npc.z);
          q.render({ frameIndex: 0 });
          this.npcQuads.push(q);
        })
        .catch((err) => console.warn('[事件] NPC 立绘加载失败:', npc.assetUrl, err));
    }
  }

  /** ★ 访客程序化身体 / GLB 模型（舰内；与事件 NPC 立绘并存）。
   *  资产已在上层加载好 → 同步创建；在家附近自动游荡（见 update）。 */
  setEventBodies(list: {
    x: number; z: number;
    asset?: FrameAssetSource | null;
    style?: VisitorBodyStyle;
    model?: VisitorModelStyle;
  }[]): void {
    for (const b of this.eventBodies) b.body.dispose();
    this.eventBodies = [];
    for (const e of list) {
      if (!e.model && !e.style) continue;
      const body: VisitorBodyLike = e.model
        ? new VisitorModelRenderer(this.sceneRef, e.model, e.asset ?? null)
        : new VisitorBodyRenderer(this.sceneRef, e.asset ?? null, e.style);
      body.setPosition(e.x, 0, e.z);
      body.setLocomotion(false, 0);
      body.update(0);
      this.eventBodies.push({
        body,
        x: e.x, z: e.z,
        homeX: e.x, homeZ: e.z,
        targetX: e.x, targetZ: e.z,
        walking: false,
        speed: 1.6,
        timer: 0.8 + Math.random() * 2.4, // 入场先站一会儿再开始走
      });
    }
  }

  /** 合并加工站 + 事件站点 → 生效交互站列表 */
  private rebuildStations(): void {
    const list: BaseStation[] = [...this.eventStations];
    if (this.craftCb) {
      // ★ 触发区 = 加工站【整间房】（进房间就一直显示提示/可按 F；用户定调）
      //   房间按 x 分间 → rx 限房间半宽、z 不限；UI 打开时提示由 updateInput 隐藏
      list.push({
        x: this.craftBayX ?? 0, z: 0,
        rx: ROOM_W / 2 - 0.5, rz: 1e9,
        label: '打开加工台',
        cb: this.craftCb,
      });
    }
    this.setStations(list);
  }

  /** ★ 交互提示/触发按键名（**默认 F，基地与舰内一律 F**）。
   *  注意：房间内**不接受 E**——E 是世界侧（进舱/登船/交互）的键，
   *  在世界侧按 E 进舱后，如果舱内也认 E，会出现"同一次按键既进舱又触发舱内站点"。 */
  setPromptKey(key: string): void {
    this.promptKey = key.toLowerCase();
  }

  /** UI 遮挡判定（BaseMode 注入：面板/覆盖层打开时为 true → 提示隐藏、按键禁用） */
  setUiBlocking(fn: () => boolean): void {
    this.uiBlocking = fn;
  }

  /** 无人机盟友：★ 三帧同时叠加绘制（主体 + 左翼 + 右翼），与游戏内 DroneCompositeRender 同管线 */
  private addDrone(asset: FrameAssetSource, size: number): void {
    const anim = new FrameAnimatorBase(asset);
    const view = new DroneCompositeRender(this.sceneRef, asset as CharacterFxAssetSource, anim);
    if (this.renderer3d) view.setRenderer(this.renderer3d); // 翅膀 VAT 离屏烘焙共享上下文
    view.setScaleKeepAspect(size);
    view.setPosition(this.charPos.x, this.charY + 2.1, this.charPos.z);
    this.droneAllies.push({ view, anim, index: this.droneAllies.length });
  }

  /** 当前出击槽（已过滤空槽） */
  private currentSlots(): string[] {
    return (this.itemManagerRef?.getSlots() ?? []).filter((s): s is string => !!s);
  }

  /** 槽内是友军无人机？（配置驱动：combat.kind='ally' + allyType='drone'） */
  private isDroneSlot(itemId: string): boolean {
    return this.itemManagerRef?.getArchetype(itemId)?.allyType === 'drone';
  }

  /** ★ 按出击槽同步无人机编队（★ 每槽一架，多架一起包围角色转圈；重复调用先清后建） */
  private syncDroneAlly(slots: string[]): void {
    for (const d of this.droneAllies) d.view.dispose();
    this.droneAllies.length = 0;
    if (!this.droneAssetSrc) return;
    for (const id of slots) {
      if (this.isDroneSlot(id)) this.addDrone(this.droneAssetSrc, 1.3);
    }
  }

  /** ★ 出击槽变化（deployment_changed）：重挂装备贴片 + 同步无人机/载具（基地内换装即时可见） */
  refreshDeployment(): void {
    const slots = this.currentSlots();
    void this.equip?.apply(slots);
    this.syncDroneAlly(slots);
    this.syncVehicle();
  }

  /** ★ 载具状态同步（换装时算一次：姿态 + 移速乘数都在 VehicleRide 内） */
  private syncVehicle(): void {
    const stats = this.itemManagerRef?.getEquipmentStats();
    this.vehicleRide?.setStats(stats ?? { vehicle: false, moveSpeedPct: 0 });
  }

  /** 固定基准 = (0, 7.4, 16.5) 看向大厅中部；实际机位由跟随更新接管 */
  setupCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    this.camDist = this.camDistTarget;
    camFollowSnap(this.camPos, this.charPos, this.camDist);
    camera.position.copy(this.camPos);
    camera.lookAt(this.charPos.x, 1.6, this.charPos.z);
  }

  /** 每帧：角色行走 → 帧动画 → 相机跟随/缩放（BaseMode.update 调用） */
  update(dt: number): void {
    this.t += dt;
    updateRoomTime(this.t); // ★ 驱动全部房间 shader（灯带呼吸 / 屏幕数据块 / 光圈脉冲）
    // ★ 驱动房间里的可动元素（几十个小变换，开销可忽略）
    for (let i = 0; i < this.roomAnims.length; i++) this.roomAnims[i](this.t, dt);
    // ★ 家具物理步进（同步 mesh + 把新位置刷进 solids：挡路判定永远跟着家具走）
    this.roomPhys?.step(dt, this.t, this.solids);
    this.updateInput(dt);
    if (this.anim && this.quad) {
      if (this.moving !== this.wasMoving) {
        this.anim.playFrames(['前0', '前1'], { fps: this.moving ? 6 : 2, loop: true });
        this.wasMoving = this.moving;
      }
      this.anim.update(dt);
      this.quad.render({ frameIndex: this.anim.frameIndex });
    }
    // ★ 站立/躺倒姿态下发（躺乘时 roll 在 setBillboard 内应用）＋装备贴片
    if (this.quad && this.camera) this.quad.setBillboard(this.camera);
    this.equip?.update(dt, this.camera ?? undefined);
    // ★ 载具贴片跟随（圆凳）
    this.vehicleRide?.update(dt, this.camera ?? undefined);
    // ★ 事件 NPC 立绘：面向相机
    if (this.camera) {
      for (const q of this.npcQuads) q.setBillboard(this.camera);
    }
    // ★ 访客身体：舰内自动走动（家附近 3~8m 游荡；停下面向维维美 + 待机小动作；
    //   对话/面板打开（uiBlocking）时原地冻结，别在交谈中走开）
    const bodiesFrozen = this.uiBlocking?.() ?? false;
    for (let i = 0; i < this.eventBodies.length; i++) {
      const b = this.eventBodies[i];
      if (!bodiesFrozen) {
        b.timer -= dt;
        if (b.walking) {
          const dx = b.targetX - b.x;
          const dz = b.targetZ - b.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.15 || b.timer <= 0) {
            b.walking = false;
            b.timer = 1.2 + Math.random() * 2.6; // 驻足 1.2~3.8s
          } else {
            const step = Math.min(d, b.speed * dt);
            const sx = (dx / d) * step;
            const sz = (dz / d) * step;
            let movedAny = false;
            if (!this.blockedCircle(b.x + sx, b.z, NPC_R)) { b.x += sx; movedAny = true; }
            if (!this.blockedCircle(b.x, b.z + sz, NPC_R)) { b.z += sz; movedAny = true; }
            if (movedAny) b.body.setYaw(Math.atan2(dx, dz));
            else { b.walking = false; b.timer = 0.3; }   // 前面是家具 → 换个目标
          }
        } else if (b.timer <= 0) {
          // 抽新目标：家附近 3~8m 随机点（房间边界内留 ~1.5m 墙距）
          const ang = Math.random() * Math.PI * 2;
          const r = 3 + Math.random() * 5;
          b.targetX = Math.max(-this.hallW / 2 + 1.5, Math.min(this.hallW / 2 - 1.5, b.homeX + Math.cos(ang) * r));
          b.targetZ = Math.max(-ROOM_D / 2 + 1.4, Math.min(ROOM_D / 2 - 1.2, b.homeZ + Math.sin(ang) * r));
          b.walking = true;
          b.timer = 6; // 单段最长 6s（防卡）
          b.speed = 1.5 + Math.random() * 0.8;
        }
        // 与维维美 / 其他访客的简单分离（别穿模）
        const pdx = b.x - this.charPos.x;
        const pdz = b.z - this.charPos.z;
        const pd = Math.hypot(pdx, pdz);
        if (pd < 1.1 && pd > 1e-4) {
          b.x = this.charPos.x + (pdx / pd) * 1.1;
          b.z = this.charPos.z + (pdz / pd) * 1.1;
        }
        for (let j = 0; j < this.eventBodies.length; j++) {
          if (j === i) continue;
          const o = this.eventBodies[j];
          const odx = b.x - o.x;
          const odz = b.z - o.z;
          const od = Math.hypot(odx, odz);
          if (od < 1.0 && od > 1e-4) {
            b.x = o.x + (odx / od) * 1.0;
            b.z = o.z + (odz / od) * 1.0;
          }
        }
      }
      // ★ 访客也脱困（分离逻辑可能把它挤进家具）
      _npcPos.set(b.x, 0, b.z);
      this.unstick(_npcPos, NPC_R);
      b.x = _npcPos.x;
      b.z = _npcPos.z;
      b.body.setPosition(b.x, 0, b.z);
      if (b.walking && !bodiesFrozen) {
        b.body.setLocomotion(true, b.speed);
      } else {
        b.body.setLocomotion(false, 0);
        // 站住时面向维维美（人走到哪看到哪）
        const fdx = this.charPos.x - b.x;
        const fdz = this.charPos.z - b.z;
        if (Math.hypot(fdx, fdz) > 0.3) b.body.setYaw(Math.atan2(fdx, fdz));
      }
      b.body.update(dt);
      // ★ 交互站跟随（交谈的触发位置跟着 NPC 走）；地面光圈同步跟
      for (const st of this.stations) {
        if (st.followBodyIndex === i) {
          st.x = b.x;
          st.z = b.z;
          for (const p of this.pads) {
            if (p.label === st.label) p.mesh.position.set(b.x, 0.03, b.z);
          }
        }
      }
    }
    // ★ 无人机编队：三帧叠加合成 + 包围角色转圈。
    //   防重叠：每层 4 架（层内 90° 间隔）、逐层半径+高度递增、层内奇偶槽再交错半径/高度，
    //   让正/背面的机体在屏幕上也拉开（纯圆环会让前后机投影到同一位置）
    const DRONES_PER_RING = 4;
    for (const d of this.droneAllies) {
      d.anim.update(dt);
      const ring = Math.floor(d.index / DRONES_PER_RING);
      const islot = d.index % DRONES_PER_RING;
      const ang = this.t * 0.7 + islot * (Math.PI / 2) + ring * 0.78;
      const radius = 2.6 + ring * 1.15 + (islot % 2) * 0.55;
      const height =
        2.0 + ring * 0.95 + (islot % 2) * 0.4 + Math.sin(this.t * 2.1 + d.index * 1.7) * 0.12;
      d.view.setPosition(
        this.charPos.x + Math.cos(ang) * radius,
        this.charY + height,
        this.charPos.z + Math.sin(ang) * radius,
      );
      d.view.render({ frameIndex: d.anim.frameIndex });
      if (this.camera) d.view.setBillboard(this.camera);
    }
    const cam = this.camera;
    if (!cam) return;
    this.camDist += (this.camDistTarget - this.camDist) * Math.min(1, dt * 6);
    camFollowSnap(_tmpTarget, this.charPos, this.camDist);
    const k = 1 - Math.exp(-dt * 5);
    this.camPos.lerp(_tmpTarget, k);
    cam.position.copy(this.camPos);
    cam.lookAt(this.charPos.x, 1.6, this.charPos.z);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('dblclick', this.onDblClick);
    window.removeEventListener('click', this.onClick);
    this.promptEl.remove();
    this.quad?.dispose();
    this.anim?.dispose();
    this.quad = null;
    this.anim = null;
    this.equip?.dispose();
    this.equip = null;
    this.vehicleRide?.dispose();
    this.vehicleRide = null;
    for (const q of this.npcQuads) q.dispose();
    this.npcQuads = [];
    for (const b of this.eventBodies) b.body.dispose();
    this.eventBodies = [];
    this.npcLoadToken++;
    for (const d of this.droneAllies) d.view.dispose();
    this.droneAllies.length = 0;
    this.pads = [];
    this.roomAnims.length = 0;
    this.clickTargets.length = 0;
    this.solids.length = 0;
    this.roomPhys?.dispose();
    this.roomPhys = null;
    this.kineticMovers.length = 0;
    this.priestess?.dispose();
    this.priestess = null;
    this.backdrop = null;
    this.mats = null;
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          // ★ userData.keep：缓存贴图（如彩蛋数字）跨房间复用，不随房间销毁
          if (std.map && (std.map as THREE.Texture).userData.keep !== true) std.map.dispose();
          m.dispose();
        }
      }
    });
    this.root.parent?.remove(this.root);
  }

  // ============================================================
  // 大厅（三间打通：共用地面/背墙/天花板，只留分界立柱与顶梁）
  // ============================================================
  // ★ 2026-09-16 用户定调：房间要"全面美化"且**不许建模**——
  //   壳体与全部实体装饰改由 RoomDeco 负责：几何走 extrudeProfile 手搓顶点，
  //   材质走 RoomSurfaceMaterial 的程序化 shader。这里只负责"装哪几面、挂哪个 add"。

  private buildHall(defs: RoomDef[]): void {
    const W = this.hallW;
    const isShip = defs.length === 1 && defs[0].id === 'cockpit';
    const mats: DecorMats = createDecorMats(isShip);
    this.mats = mats;

    const add: AddFn = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      this.root.add(m);
      return m;
    };

    // ---- 壳体（打通：一整条）—— 五大面全部换成程序化表面材质 ----
    // ★ 壳体与分界墙**不参与实体碰撞收集**：外墙/房间边界与门洞由既有钳制逻辑
    //   （DOOR_HALF 吸附到 0.9m）负责。若也让它们当实体，会与实体推出（0.7m）每帧
    //   互相顶 → 角色卡墙 + 抖动闪烁（2026-09-16 修）。
    const noSolid = (m: THREE.Mesh): THREE.Mesh => {
      m.userData.noSolid = true;
      return m;
    };
    noSolid(add(new THREE.BoxGeometry(W, WALL_T, ROOM_D), mats.floor, 0, -WALL_T / 2, 0));
    noSolid(add(new THREE.BoxGeometry(W, ROOM_H, WALL_T), mats.wall, 0, ROOM_H / 2, -ROOM_D / 2 - WALL_T / 2));
    noSolid(add(new THREE.BoxGeometry(W, WALL_T, ROOM_D), mats.ceil, 0, ROOM_H + WALL_T / 2, 0));
    noSolid(add(new THREE.BoxGeometry(WALL_T, ROOM_H, ROOM_D), mats.wall, -W / 2 - WALL_T / 2, ROOM_H / 2, 0));
    noSolid(add(new THREE.BoxGeometry(WALL_T, ROOM_H, ROOM_D), mats.wall, W / 2 + WALL_T / 2, ROOM_H / 2, 0));

    // ---- 可动元素注册器（装饰函数往里塞动画；update 每帧统一驱动）----
    const anim: RegisterAnim = (fn) => { this.roomAnims.push(fn); };
    // ---- 点击注册器（房间彩蛋：双击命中 mesh → 回调）----
    const click: RegisterClick = (mesh, cb) => { this.clickTargets.push({ mesh, cb }); };
    // ---- 运动学道具注册器（AGV / 行车吊箱 → 有物理实体，能推开家具）----
    const kinetic: RegisterKinetic = (mover) => { this.kineticMovers.push(mover); };

    // ---- 大厅级装饰：踢脚斜面 / 墙面腰线 / 天花板桁架 / 背墙管道 / 通风百叶 / 灯槽 ----
    decorateShell(add, mats, W, this.bays, anim);

    // ---- 分界：墙 + 门（2026-09-12 用户定调：房间之间要有墙、留门）----
    const segD = ROOM_D / 2 - DOOR_HALF;
    for (const bx of this.bays.slice(0, -1)) {
      const divider = bx + (ROOM_W + ROOM_GAP) / 2;
      add(new THREE.BoxGeometry(WALL_T, ROOM_H, segD), mats.wall, divider,
        ROOM_H / 2, -(ROOM_D / 2 - segD / 2)); // 后段
      add(new THREE.BoxGeometry(WALL_T, ROOM_H, segD), mats.wall, divider,
        ROOM_H / 2, ROOM_D / 2 - segD / 2);    // 前段
      add(new THREE.BoxGeometry(WALL_T + 0.1, ROOM_H - DOOR_H, DOOR_HALF * 2 + 0.3), mats.wall, divider,
        (ROOM_H + DOOR_H) / 2, 0);             // 门楣
      // ★ 门柱：**不许与墙的洞口切面共面**（共面 → z-fighting → "门的侧边一直在闪"）。
      //   门柱面留在洞口切面外 1cm，并且比门头灯带更长 → 灯带端面藏进门柱里。
      const jamb = extrudeProfile(chamferRectProfile(WALL_T + 0.08, DOOR_H, 0.05), 0.26);
      add(jamb, mats.struct, divider, DOOR_H / 2, DOOR_HALF + 0.14);   // 门柱（前）
      add(jamb, mats.struct, divider, DOOR_H / 2, -DOOR_HALF - 0.14);  // 门柱（后）
      // 门头灯带 + 门楣斜遮檐（手搓楔形，让门在俯视机位下读得出来）
      add(new THREE.BoxGeometry(WALL_T + 0.14, 0.16, DOOR_HALF * 2 + 0.40), mats.stripWarm, divider,
        DOOR_H + 0.1, 0);
      add(extrudeProfile(wedgeProfile(0.9, 0.32, 0.5), DOOR_HALF * 2 + 0.60), mats.struct,
        divider, DOOR_H + 0.62, 0);
    }

    // ---- 分区内装 + 名牌 + 顶灯 ----
    for (let i = 0; i < defs.length; i++) {
      const bay = new THREE.Group();
      bay.position.x = this.bays[i];
      this.root.add(bay);
      const addIn: AddFn = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz);
        m.rotation.set(rx, ry, rz);
        bay.add(m);
        return m;
      };
      if (defs[i].id === 'control') decorateControl(addIn, mats, anim, click);
      else if (defs[i].id === 'storage') decorateStorage(addIn, mats, anim, kinetic);
      else if (defs[i].id === 'workshop') {
        decorateWorkshop(addIn, mats, anim);
        this.craftBayX = this.bays[i]; // ★ 加工站房间（进房间就显示"打开加工台"提示）
      } else if (defs[i].id === 'cockpit') decorateCockpit(addIn, mats, anim);
      else decorateWorkshop(addIn, mats, anim);
      const plate = this.makeNameplate(defs[i].name, defs[i].label);
      addIn(new THREE.PlaneGeometry(5.4, 1.5), plate, 0, ROOM_H * 0.58, -ROOM_D / 2 + 0.14);
      addIn(new THREE.BoxGeometry(ROOM_W * 0.5, 0.08, 0.3), mats.strip, 0, ROOM_H - 0.06, 0.4);
    }

    // ---- ★ 可推家具物理（rapier）：家具成簇建 dynamic 刚体，能被角色/小车推开 ----
    this.buildRoomPhysics();
  }

  /** ★ 建可推家具物理：把"家具 mesh"交给 RoomPhysics（聚簇 → dynamic 复合刚体）。
   *  过滤与说明见 collectFurnitureMeshes；家具被推动后 solids 每帧由物理刷新。 */
  private buildRoomPhysics(): void {
    const meshes = this.collectFurnitureMeshes();
    // ★ 接触阴影面片：不进碰撞体，但跟着家具一起走（否则推走家具、影子留在原地）
    const shadows: THREE.Mesh[] = [];
    if (this.mats) {
      this.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material === this.mats?.shadow) shadows.push(o);
      });
    }
    const phys = new RoomPhysics();
    phys.addFurniture(meshes, this.root, shadows);
    phys.addRoomBounds(this.hallW / 2, ROOM_D / 2);
    for (const m of this.kineticMovers) phys.addKinetic(m);
    this.kineticMovers.length = 0;
    this.roomPhys = phys;
  }

  /** ★ 收集"可推家具"的 mesh 清单。
   *  只保留挡人走路的那一层：盒子与 [0.35, 1.6] 有交集；薄片（屏幕/贴片/铭牌）、
   *  小零件（把手/灯珠）、装饰材质（灯带/光圈/蒸汽/阴影）跳过；
   *  会动的道具（行车/小车/传送带工件/机械臂）装饰期标了 noSolid；
   *  超大盒（房间/天穹）跳过。 */
  private collectFurnitureMeshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const skip = new Set<THREE.Material | undefined>([
      this.mats?.shadow, this.mats?.pad, this.mats?.flow, this.mats?.holo, this.mats?.steam,
      this.mats?.strip, this.mats?.stripWarm, this.mats?.stripVert,
      this.mats?.screen, this.mats?.screenAlt, this.mats?.viewport,
    ]);
    const box = new THREE.Box3();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;                 // 点云/组不算
      if (o.userData.noSolid === true) return;                // 会动的道具
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (skip.has(mat) || mat?.userData?.noSolid === true) return;
      const geo = o.geometry as THREE.BufferGeometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (!geo.boundingBox) return;
      o.updateWorldMatrix(true, false);
      box.copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
      if (box.max.y < 0.35 || box.min.y > 1.6) return;        // 脚下的薄板 / 头顶的梁
      const sx = box.max.x - box.min.x;
      const sz = box.max.z - box.min.z;
      if (Math.min(sx, sz) < 0.12) return;                    // 薄片（屏幕 / 贴片 / 铭牌）
      if (sx * sz < 0.03) return;                             // 小零件（把手 / 灯珠）
      // ★ 保险：超大盒子是房间整体/天穹之类，不能当实体（否则角色被关在里面走不动）
      if (sx > 60 || sz > 60) return;
      out.push(o);
    });
    return out;
  }

  /** ★ 圆形 vs 实体 AABB 的碰撞查询（xz 平面）——移动前问一句"能不能过去" */
  private blockedCircle(x: number, z: number, r: number): boolean {
    for (let i = 0; i < this.solids.length; i++) {
      const s = this.solids[i];
      const cx = Math.max(s.minX, Math.min(x, s.maxX));
      const cz = Math.max(s.minZ, Math.min(z, s.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /** ★ 兜底脱困：已经陷在实体里（出生点 / 被挤住）→ 8 方向逐级外扩找最近的合法位。
   *  只在"当前就重叠"时调用，命中即停；找不到（极端情况）就原地不动，交给下一帧。 */
  private unstick(pos: THREE.Vector3, r: number): void {
    if (!this.blockedCircle(pos.x, pos.z, r)) return;
    const halfW = this.hallW / 2 - 0.9;
    const minZ = -ROOM_D / 2 + 0.9;
    const maxZ = ROOM_D / 2 - 1.2;
    for (let step = 1; step <= 16; step++) {
      const d = step * 0.1;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = Math.max(-halfW, Math.min(halfW, pos.x + Math.cos(a) * d));
        const z = Math.max(minZ, Math.min(maxZ, pos.z + Math.sin(a) * d));
        if (!this.blockedCircle(x, z, r)) {
          pos.x = x;
          pos.z = z;
          return;
        }
      }
    }
  }

  /** ★ 交互站地面光圈：上层把"站点列表"同步一份进来 → 玩家看得见触发区在哪。
   *  纯 shader 圆环（圆形裁切在 frag 里 discard，不占额外几何）。全量替换。 */
  setStationPads(list: StationPadSpec[]): void {
    for (const p of this.pads) {
      p.mesh.removeFromParent();
      p.mesh.geometry.dispose();
      p.mat.dispose();
    }
    this.pads = [];
    list.forEach((spec, i) => {
      const mat = createPadMaterialFor(spec.color, i * 0.37);
      const r = spec.radius ?? 2.2;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(spec.x, 0.03, spec.z);
      this.root.add(mesh);
      this.pads.push({ mesh, mat, label: spec.label });
    });
  }

  /** 名牌贴片：Canvas 文本 → 纹理（极简版：无框、无底、只留一条发丝线 + 两级文字） */
  private makeNameplate(name: string, label: string): THREE.MeshBasicMaterial {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 144;
    const g = cv.getContext('2d')!;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 顶置发丝线（代替旧版的整圈描边方框）
    g.strokeStyle = 'rgba(168,196,214,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cv.width * 0.18, 30);
    g.lineTo(cv.width * 0.82, 30);
    g.stroke();
    g.fillStyle = '#e6edf3';
    g.font = 'bold 52px "Microsoft YaHei", sans-serif';
    g.fillText(name, cv.width / 2, 74);
    g.fillStyle = 'rgba(158,186,204,0.80)';
    g.font = '28px "Microsoft YaHei", sans-serif';
    g.fillText(label, cv.width / 2, 116);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  }

  // ============================================================
  // 输入（行走 / 缩放）
  // ============================================================

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.has(k)) this.keys.add(k);
    if (k === ' ') {
      this.wantJump = true; // ★ 空格：跳跃
      e.preventDefault();
    }
    // ★ 交互站：只认配置的按键（默认 F）。房间内**禁用 E**——
    //   世界侧 E 是"进舱/登船"，同一次按键在舱内再触发一次就是重复响应。
    //   UI 遮挡期不响应，避免叠层里再开。
    if (k === this.promptKey && this.activeStation && !(this.uiBlocking?.() ?? false)) {
      this.activeStation.cb();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  /** ★ 彩蛋：地球转满 100 圈 → 普瑞赛斯在星球表面出现（弹性放大，随后常驻）
   *  触发后每帧只做"放大 + 朝向相机"，开销可忽略。 */
  private updatePriestess(t: number, dt: number): void {
    const q = this.priestess;
    if (!q) return;
    if (this.priestessAt === 0) {
      // ★ 预览期：暂时设为 1 圈（约 14 秒）就能看到；正式值 100 圈（见 PRIESTESS_TURNS）
      if (this.earthTurns < PRIESTESS_TURNS) return;
      this.priestessAt = t;
    }
    void dt;
    const k = Math.min(1, (t - this.priestessAt) / 1.6);
    const ease = 1 - Math.pow(1 - k, 3);
    const pop = 1 + 0.10 * Math.sin(k * 16.0) * (1 - k);   // 登场回弹
    // ★ 先缩放、再重设位置（底部锚点抬升要按新高度算 → 否则立绘沉到窗口外）
    const h = Math.max(0.01, PRIESTESS_H * ease * pop);
    q.setScale(h / this.priestessAspect, h);
    // ★ 位置固定（不跟随镜头）+ 立牌式朝向镜头（和之前一样）
    q.setPosition(PRIESTESS_X, PRIESTESS_Y, PRIESTESS_Z);
    q.setVisible(ease > 0.01);
    q.render({ frameIndex: this.priestessFrame });
    if (this.camera) q.setBillboard(this.camera);
  }

  /** ★ 双击：射线命中注册过的 mesh → 触发回调（房间彩蛋；UI 遮挡时不响应） */
  private onDblClick = (e: MouseEvent): void => {
    const canvas = this.renderer3d?.domElement;
    if (!canvas || (e.target !== canvas && e.target !== document.body)) return;
    if (!this.camera || this.clickTargets.length === 0) return;
    if (this.uiBlocking?.() ?? false) return;
    this.ndc.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.clickTargets.map((c) => c.mesh), false);
    if (hits.length === 0) return;
    const hit = this.clickTargets.find((c) => c.mesh === hits[0].object);
    hit?.cb();
  };

  /** 滚轮：缩放视野（改跟随机距；8~45m 平滑；房间 3× 后放宽上限） */
  private onWheel = (e: WheelEvent): void => {
    this.camDistTarget = Math.max(8, Math.min(45, this.camDistTarget * (1 + e.deltaY * 0.0012)));
  };

  /** UI 遮挡判定（未注入时视为不遮挡） */
  private isUiBlocked(): boolean {
    return this.uiBlocking?.() ?? false;
  }

  /** ★ 单击：射线命中**星点云** → 那颗星熄灭（彩蛋）。
   *  用房间几何做遮挡判定：墙/家具/立绘挡在前面的星点不会被点到。 */
  private onClick = (e: MouseEvent): void => {
    const canvas = this.renderer3d?.domElement;
    if (!canvas || (e.target !== canvas && e.target !== document.body)) return;
    if (!this.camera || !this.backdrop || this.isUiBlocked()) return;
    this.ndc.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.params.Points.threshold = 2.0;   // 244 距离处 2 世界单位 ≈ 几像素
    const hits = this.raycaster.intersectObject(this.backdrop.stars, false);
    if (hits.length === 0) return;
    // 房间几何挡在前面就不算点中（否则会点到"墙后面的星星"）
    const blocked = this.raycaster.intersectObject(this.root, true);
    if (blocked.length > 0 && blocked[0].distance < hits[0].distance) return;
    const idx = (hits[0] as THREE.Intersection & { index?: number }).index ?? -1;
    this.backdrop.extinguish(idx);
  };

  private updateInput(dt: number): void {
    // ★ UI 遮挡（面板/对话打开）：角色站定 + **交互提示必须立即隐藏**
    //   （此前直接 return，提示隐藏逻辑在后方 → 提示会盖在加工台/抽卡页之上）
    if (this.uiBlocking?.() ?? false) {
      this.moving = false;
      this.wantJump = false;
      if (this.promptShown) {
        this.promptShown = false;
        this.promptEl.style.display = 'none';
      }
      this.activeStation = null;
      return;
    }
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('a') || k.has('arrowleft')) mx -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    if (k.has('w') || k.has('arrowup')) mz -= 1;
    if (k.has('s') || k.has('arrowdown')) mz += 1;
    const len = Math.hypot(mx, mz);
    this.moving = len > 0;
    if (this.quad) {
      const prevX = this.charPos.x;
      if (this.moving) {
        const spd = MOVE_SPEED * (this.vehicleRide?.moveSpeedMul ?? 1); // ★ 载具移速提升
        // ★ 逐轴推进 + 碰撞拒绝（撞到实体就取消该轴位移）：
        //   不用"先走再推出"——推出方向可能正对房间外墙，会被边界夹回来，每帧互顶 → 卡死。
        //   拒绝式的好处：撞墙自然沿墙滑行，且永远不会把角色塞进墙里。
        const stepX = (mx / len) * spd * dt;
        const stepZ = (mz / len) * spd * dt;
        if (!this.blockedCircle(this.charPos.x + stepX, this.charPos.z, CHAR_R)) {
          this.charPos.x += stepX;
        }
        if (!this.blockedCircle(this.charPos.x, this.charPos.z + stepZ, CHAR_R)) {
          this.charPos.z += stepZ;
        }
        // ★ 推挤：与角色相交的家具簇被施加冲量（无扭矩 → 平移不翻倒）
        const dx = mx / len;
        const dz = mz / len;
        this.roomPhys?.pushAt(this.charPos.x, this.charPos.z, CHAR_R + 0.12, dx, dz);
      }
      // 边界
      const halfW = this.hallW / 2 - 0.9;
      this.charPos.x = Math.max(-halfW, Math.min(halfW, this.charPos.x));
      this.charPos.z = Math.max(-ROOM_D / 2 + 0.9, Math.min(ROOM_D / 2 - 1.2, this.charPos.z));
      // ★ 分界墙阻挡：过墙必须走门洞（|z| ≤ DOOR_HALF）。
      //   ⚠️ 用"贴墙半径"判定（不用跨越符号）：低帧率一帧位移可能 > 半径，
      //   跨线判定会 越线→弹回→再越线 反复横跳（用户反馈"卡住不停闪"）。
      for (const bx of this.bays.slice(0, -1)) {
        const d = bx + (ROOM_W + ROOM_GAP) / 2;
        if (Math.abs(this.charPos.z) <= DOOR_HALF) continue; // 门洞内可通行
        const half = 0.9; // 贴墙停靠距离（含立绘宽度余量，避免穿插闪面）
        if (Math.abs(this.charPos.x - d) < half) {
          this.charPos.x = d + (prevX >= d ? half : -half);
        }
      }
      // ★ 兜底脱困（出生点 / 被会动道具挤住 / 门洞吸附后仍在实体里）
      this.unstick(this.charPos, CHAR_R);
      // 跳跃（空格；着地才可起跳）
      if (this.wantJump && this.grounded) {
        this.vy = JUMP_V;
        this.grounded = false;
      }
      this.wantJump = false;
      if (!this.grounded) {
        this.vy -= GRAVITY * dt;
        this.charY += this.vy * dt;
        if (this.charY <= 0) { this.charY = 0; this.vy = 0; this.grounded = true; }
      }
      if (mx !== 0) {
        const faceRight = mx > 0;
        if (faceRight !== this.facingRight) {
          this.facingRight = faceRight;
          this.quad.setFlip(!faceRight, false); // 左行镜像（素材默认朝右）
        }
      }
      this.quad.setPosition(this.charPos.x, this.charY, this.charPos.z);
      // ★ 加工站区域判定（在加工站房间内 → 显示"F · 打开加工台"提示）；
      //   抽卡/加工台/背包等 UI 打开时（uiBlocking）不绘制提示
      // ★ 交互站判定（大厅坐标；最近的命中站点生效）→ 显示"F · 标签"
      const lx = this.charPos.x;
      const lz = this.charPos.z;
      let best: BaseStation | null = null;
      let bestD = Infinity;
      for (const st of this.stations) {
        if (Math.abs(lx - st.x) > st.rx || Math.abs(lz - st.z) > st.rz) continue;
        const d = Math.hypot(lx - st.x, lz - st.z);
        if (d < bestD) { bestD = d; best = st; }
      }
      this.activeStation = best;
      const showPrompt = !!best && !(this.uiBlocking?.() ?? false);
      if (showPrompt !== this.promptShown) {
        this.promptShown = showPrompt;
        this.promptEl.style.display = showPrompt ? 'block' : 'none';
      }
      if (best) {
        const promptText = `${this.promptKey.toUpperCase()} · ${best.label}`;
        if (this.promptEl.textContent !== promptText) this.promptEl.textContent = promptText;
      }
    } else {
      this.wantJump = false;
    }
  }
}

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** 跟随机位目标：x 跟角色，高度/距离随缩放（y = 4.5 + dist×0.18，z = 角色 z + dist） */
const _tmpTarget = new THREE.Vector3();
const _npcPos = new THREE.Vector3();
function camFollowSnap(out: THREE.Vector3, charPos: THREE.Vector3, dist: number): void {
  out.set(charPos.x, 4.5 + dist * 0.18, charPos.z + dist);
}
