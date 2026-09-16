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
  type AddFn, type DecorMats, type RegisterAnim, type RegisterClick,
} from './RoomDecor';
import { chamferRectProfile, extrudeProfile, wedgeProfile } from '../../services/render/RoomDecoGeo';
import { createSpaceBackdrop } from '../../services/render/SpaceBackdrop';

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
  /** ★ 可点击目标（房间彩蛋：双击命中 → 回调） */
  private clickTargets: { mesh: THREE.Object3D; cb: () => void }[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  // ---- 角色（维维美） ----
  private quad: FTXQuad | null = null;
  private anim: FrameAnimatorBase | null = null;
  private charPos = new THREE.Vector3(0, 0, 1.0);
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
      const backdrop = createSpaceBackdrop(scene);
      this.root.add(backdrop.dome, backdrop.earth);
      // 整片星空缓慢自转（"不停的动"）；地球自转在 shader 里靠共享时钟驱动
      this.roomAnims.push((_t, dt) => {
        backdrop.dome.rotation.y -= dt * 0.0045;
      });
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
            b.x += (dx / d) * step;
            b.z += (dz / d) * step;
            b.body.setYaw(Math.atan2(dx, dz));
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
    add(new THREE.BoxGeometry(W, WALL_T, ROOM_D), mats.floor, 0, -WALL_T / 2, 0);
    add(new THREE.BoxGeometry(W, ROOM_H, WALL_T), mats.wall, 0, ROOM_H / 2, -ROOM_D / 2 - WALL_T / 2);
    add(new THREE.BoxGeometry(W, WALL_T, ROOM_D), mats.ceil, 0, ROOM_H + WALL_T / 2, 0);
    add(new THREE.BoxGeometry(WALL_T, ROOM_H, ROOM_D), mats.wall, -W / 2 - WALL_T / 2, ROOM_H / 2, 0);
    add(new THREE.BoxGeometry(WALL_T, ROOM_H, ROOM_D), mats.wall, W / 2 + WALL_T / 2, ROOM_H / 2, 0);

    // ---- 可动元素注册器（装饰函数往里塞动画；update 每帧统一驱动）----
    const anim: RegisterAnim = (fn) => { this.roomAnims.push(fn); };
    // ---- 点击注册器（房间彩蛋：双击命中 mesh → 回调）----
    const click: RegisterClick = (mesh, cb) => { this.clickTargets.push({ mesh, cb }); };

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
      else if (defs[i].id === 'storage') decorateStorage(addIn, mats, anim);
      else if (defs[i].id === 'workshop') {
        decorateWorkshop(addIn, mats, anim);
        this.craftBayX = this.bays[i]; // ★ 加工站房间（进房间就显示"打开加工台"提示）
      } else if (defs[i].id === 'cockpit') decorateCockpit(addIn, mats, anim);
      else decorateWorkshop(addIn, mats, anim);
      const plate = this.makeNameplate(defs[i].name, defs[i].label);
      addIn(new THREE.PlaneGeometry(5.4, 1.5), plate, 0, ROOM_H * 0.58, -ROOM_D / 2 + 0.14);
      addIn(new THREE.BoxGeometry(ROOM_W * 0.5, 0.08, 0.3), mats.strip, 0, ROOM_H - 0.06, 0.4);
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
        this.charPos.x += (mx / len) * spd * dt;
        this.charPos.z += (mz / len) * spd * dt;
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
function camFollowSnap(out: THREE.Vector3, charPos: THREE.Vector3, dist: number): void {
  out.set(charPos.x, 4.5 + dist * 0.18, charPos.z + dist);
}
