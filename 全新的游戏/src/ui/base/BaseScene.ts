// ============================================================
// BaseScene —— 基地内部 3D 剖切空间（2026-09-12 二版：三间打通 + 角色行走）
// ============================================================
// 用户定调：
//   · 手绘标注是 **3D 示意图**——按它搭"真正的一块空间"（地板/背墙/天花板/侧壁，
//     正面敞开 = 剖切面）；**三个房间打通**成一间大厅（只留分界立柱/顶梁）；
//   · **维维美（主角）在里面**：WASD/方向键在大厅内行走（立绘 + 走/待机帧动画）；
//   · **镜头跟随维维美**：平滑跟随；**滚轮缩放视野**（改跟随机距）；
//   · 原来的页面按钮（MainButtons）保持不变；基地不绘制战机。
// 生命周期：ShipMode.enter 创建、exit dispose（几何/材质/贴图/监听全清）。

import * as THREE from 'three';
import { FTXQuad } from '../../services/render/FTXQuad';
import { FrameAnimatorBase } from '../../services/fx/FrameAnimatorBase';
import type { FrameAssetSource } from '../../services/fx/AssetSource';
import baseRooms from '../../config/baseRooms.json';

interface RoomDef {
  id: string;
  name: string;
  kind: string;
  label: string;
}

/** 单间尺寸（米）与分界缝；三间打通 = 大厅宽 = 3×ROOM_W + 2×ROOM_GAP */
const ROOM_W = 9;
const ROOM_H = 4.2;
const ROOM_D = 6;
const ROOM_GAP = 1.4;
const WALL_T = 0.3;
/** 角色参数（2026-09-12 用户定调：可跳跃、移速加快） */
const MOVE_SPEED = 6.2;
const JUMP_V = 7.2;
const GRAVITY = 20;
/** 分界墙门洞半宽（沿进深 z；门高 3.0） */
const DOOR_HALF = 1.1;
const DOOR_H = 3.0;

export class BaseScene {
  private root: THREE.Group;
  private hallW: number;
  private bays: number[] = [];

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

  // ---- 相机（跟随 + 缩放） ----
  private camera: THREE.PerspectiveCamera | null = null;
  private camPos = new THREE.Vector3(0, 7.4, 16.5);
  private camDist = 16.5;
  private camDistTarget = 16.5;

  constructor(scene: THREE.Scene, protagonistAsset?: FrameAssetSource) {
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
    if (protagonistAsset) {
      this.quad = new FTXQuad(scene, protagonistAsset);
      this.quad.setScaleKeepAspect(2.4);
      this.quad.setAnchorBottom(true);
      this.quad.setPosition(this.charPos.x, 0, this.charPos.z);
      this.anim = new FrameAnimatorBase(protagonistAsset);
      this.anim.playFrames(['前0', '前1'], { fps: 2, loop: true });
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

  /** 加工站交互回调（ShipMode 注入：打开加工台覆盖层） */
  onCraftStation(cb: () => void): void {
    this.craftCb = cb;
  }

  /** 固定基准 = (0, 7.4, 16.5) 看向大厅中部；实际机位由跟随更新接管 */
  setupCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    this.camDist = this.camDistTarget;
    camFollowSnap(this.camPos, this.charPos, this.camDist);
    camera.position.copy(this.camPos);
    camera.lookAt(this.charPos.x, 1.6, this.charPos.z);
  }

  /** 每帧：角色行走 → 帧动画 → 相机跟随/缩放（ShipMode.update 调用） */
  update(dt: number): void {
    this.updateInput(dt);
    if (this.anim && this.quad) {
      if (this.moving !== this.wasMoving) {
        this.anim.playFrames(['前0', '前1'], { fps: this.moving ? 6 : 2, loop: true });
        this.wasMoving = this.moving;
      }
      this.anim.update(dt);
      this.quad.render({ frameIndex: this.anim.frameIndex });
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
      addIn(new THREE.PlaneGeometry(3.2, 0.9), plate, 0, ROOM_H + 0.9, -ROOM_D / 2 + 0.4);
      addIn(new THREE.BoxGeometry(ROOM_W * 0.5, 0.08, 0.3), matEmis(0xdfefff), 0, ROOM_H - 0.06, 0.4);
    }
  }

  /** 指挥室占位：屏幕墙 + 操作台 + 座椅 */
  private fillControl(
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rx?: number, ry?: number, rz?: number) => THREE.Mesh,
    matStd: (hex: number, rough?: number) => THREE.MeshStandardMaterial,
    matEmis: (hex: number) => THREE.MeshBasicMaterial,
  ): void {
    const zb = -ROOM_D / 2 + 0.4;
    for (let i = -1; i <= 1; i++) {
      add(new THREE.BoxGeometry(2.0, 1.2, 0.12), matEmis(0x2e6f8f), i * 2.4, 2.5, zb + 0.02);
      add(new THREE.BoxGeometry(2.2, 1.4, 0.1), matStd(0x0e1a22), i * 2.4, 2.5, zb);
    }
    add(new THREE.BoxGeometry(7.2, 0.16, 1.1), matStd(0x2a3742), 0, 1.1, -0.6);
    add(new THREE.BoxGeometry(7.2, 0.9, 0.16), matStd(0x1e2830), 0, 0.55, -1.05);
    for (const dx of [-2.2, 0, 2.2]) {
      add(new THREE.BoxGeometry(0.7, 0.12, 0.7), matStd(0x37424e), dx, 0.62, 1.1);
      add(new THREE.BoxGeometry(0.7, 0.9, 0.12), matStd(0x37424e), dx, 1.06, 1.42);
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
    crate(-3.0, 0, -1.4, 1.3, 0x3a4753);
    crate(-1.6, 0, -1.6, 1.1, 0x44515e);
    crate(-2.3, 1.3, -1.5, 1.0, 0x4a5764);
    crate(1.6, 0, -1.3, 1.4, 0x3a4753);
    crate(3.0, 0, -1.7, 1.0, 0x44515e);
    crate(2.3, 1.4, -1.4, 0.9, 0x4a5764);
    add(new THREE.BoxGeometry(1.6, 0.14, 1.2), matStd(0x2a343d), 0.6, 0.07, 1.6);
  }

  /** 加工站占位：工作台 + 机械臂 */
  private fillWorkshop(
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, rx?: number, ry?: number, rz?: number) => THREE.Mesh,
    matStd: (hex: number, rough?: number) => THREE.MeshStandardMaterial,
  ): void {
    add(new THREE.BoxGeometry(4.6, 0.18, 1.4), matStd(0x2a3742), 0, 1.1, -1.2);
    add(new THREE.BoxGeometry(4.6, 0.9, 0.3), matStd(0x1e2830), 0, 0.55, -1.75);
    add(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 10), matStd(0x54616e), 2.4, 2.0, -1.9);
    add(new THREE.CylinderGeometry(0.12, 0.12, 1.8, 10), matStd(0x54616e), 1.6, 3.0, -1.6, 0, 0, 1.0);
    add(new THREE.BoxGeometry(0.5, 0.3, 0.5), matStd(0x6b7885), 0.9, 3.3, -1.5);
    add(new THREE.BoxGeometry(0.8, 0.6, 0.8), matStd(0x4a5764), -1.2, 1.5, -1.2);
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

  /** 滚轮：缩放视野（改跟随机距；6~26m 平滑） */
  private onWheel = (e: WheelEvent): void => {
    this.camDistTarget = Math.max(6, Math.min(26, this.camDistTarget * (1 + e.deltaY * 0.0012)));
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
