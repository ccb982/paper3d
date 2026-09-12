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
import type { ItemManager } from '../../systems/inventory/ItemManager';
import baseRooms from '../../config/baseRooms.json';

interface RoomDef {
  id: string;
  name: string;
  kind: string;
  label: string;
}

/** 单间尺寸（米）与分界缝；三间打通 = 大厅宽 = 3×ROOM_W + 2×ROOM_GAP
 *  ★ 2026-09-12 用户定调：房间扩大三倍（27×12.6×18m；门/家具保持人体尺度） */
const ROOM_W = 27;
const ROOM_H = 12.6;
const ROOM_D = 18;
const ROOM_GAP = 1.4;
const WALL_T = 0.3;
/** 角色参数（2026-09-12 用户定调：可跳跃、移速加快；房间 3× 后再提一档） */
const MOVE_SPEED = 9.5;
const JUMP_V = 7.2;
const GRAVITY = 20;
/** 分界墙门洞半宽（沿进深 z；门高 3.0） */
const DOOR_HALF = 1.1;
const DOOR_H = 3.0;

export interface BaseSceneOptions {
  /** 主角立绘（维维美） */
  protagonistAsset?: FrameAssetSource;
  /** 盟友立绘素材（无人机；祖宗为弹药消耗品不再绘制） */
  droneAsset?: FrameAssetSource;
  /** 出击槽读取（装备贴片 / 盟友跟随） */
  itemManager?: ItemManager;
  /** WebGL 渲染器（无人机三帧合成 + 翅膀 VAT 离屏烘焙共享上下文用） */
  renderer?: THREE.WebGLRenderer;
}

export class BaseScene {
  private sceneRef: THREE.Scene;
  /** 主渲染器（无人机翅膀 VAT 离屏烘焙共享上下文） */
  private renderer3d: THREE.WebGLRenderer | null = null;
  private root: THREE.Group;
  private hallW: number;
  private bays: number[] = [];

  /** 通用时钟（盟友绕行/呼吸等周期动画用） */
  private t = 0;

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

  // ---- 加工站交互（走到加工站房间按 F 打开加工台；2026-09-12 用户定调） ----
  private craftBayX: number | null = null;
  private inCraftZone = false;
  private craftCb: (() => void) | null = null;
  private promptEl: HTMLDivElement;

  // ---- 身上的各种图标（装备贴片）与盟友跟随 ----
  //   无人机 = DroneCompositeRender（★ 三帧叠加合成：主体 + 左翼 + 右翼，与游戏内同管线）
  //   祖宗是弹药消耗品 → 基地内不绘制
  private equip: EquipmentLayer | null = null;
  private droneAllies: { view: DroneCompositeRender; anim: FrameAnimatorBase; index: number }[] = [];
  private droneAssetSrc: FrameAssetSource | null = null;
  private itemManagerRef: ItemManager | null = null;

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

    // 环境光（冷顶光 + 暖补光）
    const hemi = new THREE.HemisphereLight(0x9db4c8, 0x141a20, 0.85);
    const key = new THREE.DirectionalLight(0xd8e6f2, 1.05);
    key.position.set(-6, 10, 8);
    const warm = new THREE.DirectionalLight(0xffd6a0, 0.35);
    warm.position.set(7, 4, 6);
    this.root.add(hemi, key, warm);

    const defs = baseRooms.rooms as RoomDef[];
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
      }
      this.syncDroneAlly(slots);
    }

    // 加工站提示条（靠近加工站房间时显示）
    this.promptEl = document.createElement('div');
    this.promptEl.style.cssText =
      'position:fixed;left:50%;bottom:16%;transform:translateX(-50%);display:none;'
      + 'color:#ffe9b0;background:rgba(20,14,4,0.88);border:1px solid rgba(216,166,58,0.7);'
      + 'padding:6px 14px;border-radius:8px;font:14px "Microsoft YaHei",sans-serif;'
      + 'z-index:600;pointer-events:none;white-space:pre';
    this.promptEl.textContent = 'F · 打开加工台';
    document.body.appendChild(this.promptEl);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  /** 加工站交互回调（BaseMode 注入：打开加工台覆盖层） */
  onCraftStation(cb: () => void): void {
    this.craftCb = cb;
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

  /** ★ 出击槽变化（deployment_changed）：重挂装备贴片 + 同步无人机（基地内在背包页换装即时可见） */
  refreshDeployment(): void {
    const slots = this.currentSlots();
    void this.equip?.apply(slots);
    this.syncDroneAlly(slots);
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
    this.updateInput(dt);
    if (this.anim && this.quad) {
      if (this.moving !== this.wasMoving) {
        this.anim.playFrames(['前0', '前1'], { fps: this.moving ? 6 : 2, loop: true });
        this.wasMoving = this.moving;
      }
      this.anim.update(dt);
      this.quad.render({ frameIndex: this.anim.frameIndex });
    }
    // ★ 身上的装备贴片（帧动画 + 影子；与游戏内同管线）
    this.equip?.update(dt, this.camera ?? undefined);
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
    this.promptEl.remove();
    this.quad?.dispose();
    this.anim?.dispose();
    this.quad = null;
    this.anim = null;
    this.equip?.dispose();
    this.equip = null;
    for (const d of this.droneAllies) d.view.dispose();
    this.droneAllies.length = 0;
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          std.map?.dispose();
          m.dispose();
        }
      }
    });
    this.root.parent?.remove(this.root);
  }

  // ============================================================
  // 大厅（三间打通：共用地面/背墙/天花板，只留分界立柱与顶梁）
  // ============================================================

  private buildHall(defs: RoomDef[]): void {
    const W = this.hallW;
    const matStd = (hex: number, rough = 0.88): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.08 });
    const matEmis = (hex: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: hex });
    const add = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      this.root.add(m);
      return m;
    };
    // 壳体（打通：一整条）
    add(new THREE.BoxGeometry(W, WALL_T, ROOM_D), matStd(0x1d2b33), 0, -WALL_T / 2, 0);
    add(new THREE.BoxGeometry(W, ROOM_H, WALL_T), matStd(0x16242e), 0, ROOM_H / 2, -ROOM_D / 2 - WALL_T / 2);
    add(new THREE.BoxGeometry(W, WALL_T, ROOM_D), matStd(0x101c24), 0, ROOM_H + WALL_T / 2, 0);
    add(new THREE.BoxGeometry(WALL_T, ROOM_H, ROOM_D), matStd(0x121f28), -W / 2 - WALL_T / 2, ROOM_H / 2, 0);
    add(new THREE.BoxGeometry(WALL_T, ROOM_H, ROOM_D), matStd(0x121f28), W / 2 + WALL_T / 2, ROOM_H / 2, 0);
    // 背墙灯带（贯通）+ 天花板灯管（每间一根）
    add(new THREE.BoxGeometry(W * 0.9, 0.12, 0.06), matEmis(0xffd6a0), 0, ROOM_H * 0.78, -ROOM_D / 2 + 0.05);
    // ★ 分界：墙 + 门（2026-09-12 用户定调：房间之间要有墙、留门）
    //   墙沿进深 z 分成前后两段，中间留门洞；俯视机位下前后段错位投影 →
    //   门洞清晰可见；门框（门楣 + 门柱）强化"门"的读感。
    const segD = ROOM_D / 2 - DOOR_HALF; // 单段深度
    for (const bx of this.bays.slice(0, -1)) {
      const divider = bx + (ROOM_W + ROOM_GAP) / 2;
      add(new THREE.BoxGeometry(WALL_T, ROOM_H, segD), matStd(0x1a2830), divider,
        ROOM_H / 2, -(ROOM_D / 2 - segD / 2)); // 后段
      add(new THREE.BoxGeometry(WALL_T, ROOM_H, segD), matStd(0x1a2830), divider,
        ROOM_H / 2, ROOM_D / 2 - segD / 2);    // 前段
      add(new THREE.BoxGeometry(WALL_T + 0.1, ROOM_H - DOOR_H, DOOR_HALF * 2 + 0.3), matStd(0x1a2830), divider,
        (ROOM_H + DOOR_H) / 2, 0);             // 门楣
      add(new THREE.BoxGeometry(WALL_T + 0.08, DOOR_H, 0.22), matStd(0x2b3a45), divider,
        DOOR_H / 2, DOOR_HALF + 0.11);         // 门柱（前）
      add(new THREE.BoxGeometry(WALL_T + 0.08, DOOR_H, 0.22), matStd(0x2b3a45), divider,
        DOOR_H / 2, -DOOR_HALF - 0.11);        // 门柱（后）
      add(new THREE.BoxGeometry(WALL_T + 0.14, 0.16, DOOR_HALF * 2 + 0.44), matEmis(0x8fd0ff), divider,
        DOOR_H + 0.1, 0);                      // 门头灯带
    }
    // 分区内装 + 名牌 + 顶灯
    for (let i = 0; i < defs.length; i++) {
      const bay = new THREE.Group();
      bay.position.x = this.bays[i];
      this.root.add(bay);
      const addIn = (
        geo: THREE.BufferGeometry, mat: THREE.Material,
        px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0,
      ): THREE.Mesh => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz);
        m.rotation.set(rx, ry, rz);
        bay.add(m);
        return m;
      };
      if (defs[i].id === 'control') this.fillControl(addIn, matStd, matEmis);
      else if (defs[i].id === 'storage') this.fillStorage(addIn, matStd);
      else if (defs[i].id === 'workshop') {
        this.fillWorkshop(addIn, matStd);
        this.craftBayX = this.bays[i]; // ★ 加工站房间（按 F 打开加工台的区域）
      } else this.fillWorkshop(addIn, matStd);
      const plate = this.makeNameplate(defs[i].name, defs[i].label);
      // 名牌贴背墙中部（房间 3× 后尺寸放大；不要放到天花板之上）
      addIn(new THREE.PlaneGeometry(5.4, 1.5), plate, 0, ROOM_H * 0.58, -ROOM_D / 2 + 0.4);
      addIn(new THREE.BoxGeometry(ROOM_W * 0.5, 0.08, 0.3), matEmis(0xdfefff), 0, ROOM_H - 0.06, 0.4);
    }
  }

  /** 指挥室占位：屏幕墙 + 操作台 + 座椅 */
  private fillControl(
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rx?: number, ry?: number, rz?: number) => THREE.Mesh,
    matStd: (hex: number, rough?: number) => THREE.MeshStandardMaterial,
    matEmis: (hex: number) => THREE.MeshBasicMaterial,
  ): void {
    const zb = -ROOM_D / 2 + 0.6; // 背墙内侧（房间 3×：贴背墙布置）
    for (let i = -1; i <= 1; i++) {
      add(new THREE.BoxGeometry(3.0, 1.8, 0.14), matEmis(0x2e6f8f), i * 5.0, 3.2, zb + 0.03);
      add(new THREE.BoxGeometry(3.3, 2.1, 0.12), matStd(0x0e1a22), i * 5.0, 3.2, zb);
    }
    // 长操作台（人体尺度，居中）
    add(new THREE.BoxGeometry(16, 0.2, 1.4), matStd(0x2a3742), 0, 1.1, -5.0);
    add(new THREE.BoxGeometry(16, 1.0, 0.2), matStd(0x1e2830), 0, 0.55, -5.8);
    for (const dx of [-5.0, 0, 5.0]) {
      add(new THREE.BoxGeometry(0.8, 0.14, 0.8), matStd(0x37424e), dx, 0.62, -2.6);
      add(new THREE.BoxGeometry(0.8, 1.0, 0.14), matStd(0x37424e), dx, 1.1, -2.1);
    }
  }

  /** 仓库占位：货箱堆 */
  private fillStorage(
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rx?: number, ry?: number, rz?: number) => THREE.Mesh,
    matStd: (hex: number, rough?: number) => THREE.MeshStandardMaterial,
  ): void {
    const crate = (x: number, y: number, z: number, s: number, tone: number): void => {
      add(new THREE.BoxGeometry(s, s, s), matStd(tone), x, y + s / 2, z);
      add(new THREE.BoxGeometry(s * 0.92, 0.1, s * 0.92), matStd(0x1a2229), x, y + s * 0.62, z);
    };
    // 沿背墙一排货堆（人体尺度货箱铺满 27m 宽；房间 3×）
    crate(-10.0, 0, -6.6, 1.4, 0x3a4753);
    crate(-8.4, 0, -6.9, 1.2, 0x44515e);
    crate(-9.2, 1.4, -6.7, 1.0, 0x4a5764);
    crate(-2.0, 0, -6.5, 1.5, 0x3a4753);
    crate(-0.3, 0, -6.8, 1.1, 0x44515e);
    crate(5.5, 0, -6.4, 1.4, 0x3a4753);
    crate(7.2, 0, -6.7, 1.2, 0x44515e);
    crate(6.3, 1.5, -6.5, 1.0, 0x4a5764);
    crate(11.0, 0, -6.8, 1.3, 0x44515e);
    // 托盘（散放在中区）
    add(new THREE.BoxGeometry(1.8, 0.16, 1.4), matStd(0x2a343d), -5.0, 0.08, -2.0);
    add(new THREE.BoxGeometry(1.8, 0.16, 1.4), matStd(0x2a343d), 3.0, 0.08, 0.5);
  }

  /** 加工站占位：工作台 + 机械臂 */
  private fillWorkshop(
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rx?: number, ry?: number, rz?: number) => THREE.Mesh,
    matStd: (hex: number, rough?: number) => THREE.MeshStandardMaterial,
  ): void {
    const zb = -ROOM_D / 2 + 2.2; // 工作台靠背墙（房间 3×）
    add(new THREE.BoxGeometry(6.0, 0.2, 1.6), matStd(0x2a3742), 0, 1.1, zb);
    add(new THREE.BoxGeometry(6.0, 1.0, 0.35), matStd(0x1e2830), 0, 0.55, zb - 0.8);
    // 两节机械臂（人体尺度）
    add(new THREE.CylinderGeometry(0.18, 0.26, 2.4, 10), matStd(0x54616e), 4.6, 2.4, zb - 0.4);
    add(new THREE.CylinderGeometry(0.14, 0.14, 3.0, 10), matStd(0x54616e), 2.6, 4.2, zb + 0.2, 0, 0, 1.0);
    add(new THREE.BoxGeometry(0.6, 0.36, 0.6), matStd(0x6b7885), 1.2, 4.8, zb + 0.4);
    // 工件
    add(new THREE.BoxGeometry(0.9, 0.7, 0.9), matStd(0x4a5764), -0.8, 1.55, zb);
  }

  /** 名牌贴片：Canvas 文本 → 纹理 */
  private makeNameplate(name: string, label: string): THREE.MeshBasicMaterial {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 144;
    const g = cv.getContext('2d')!;
    g.fillStyle = 'rgba(8,16,22,0.85)';
    g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = 'rgba(120,220,255,0.45)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, cv.width - 4, cv.height - 4);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#dcecf6';
    g.font = 'bold 56px "Microsoft YaHei", sans-serif';
    g.fillText(name, cv.width / 2, 56);
    g.fillStyle = 'rgba(150,190,210,0.75)';
    g.font = '30px "Microsoft YaHei", sans-serif';
    g.fillText(label, cv.width / 2, 106);
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
    if (k === 'f' && this.inCraftZone) this.craftCb?.(); // ★ 加工站：F 打开加工台
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  /** 滚轮：缩放视野（改跟随机距；8~45m 平滑；房间 3× 后放宽上限） */
  private onWheel = (e: WheelEvent): void => {
    this.camDistTarget = Math.max(8, Math.min(45, this.camDistTarget * (1 + e.deltaY * 0.0012)));
  };

  private updateInput(dt: number): void {
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
        this.charPos.x += (mx / len) * MOVE_SPEED * dt;
        this.charPos.z += (mz / len) * MOVE_SPEED * dt;
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
      // ★ 加工站区域判定（在加工站房间内 → 显示"F · 打开加工台"提示）
      const inZone = this.craftBayX !== null
        && Math.abs(this.charPos.x - this.craftBayX) <= ROOM_W / 2 - 0.5;
      if (inZone !== this.inCraftZone) {
        this.inCraftZone = inZone;
        this.promptEl.style.display = inZone ? 'block' : 'none';
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
