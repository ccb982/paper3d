// ============================================================
// WorldMode —— 大世界模式（实体管线驱动的验证场景）
// ============================================================
// 组合职责（架构 2.2）：
//   - 地图（数据/查询/渲染）+ 相机（CameraController）
//   - 实体管线：Player（CharacterBase）实例 —— 模式只做组合，不碰实体内部
//   - 准星 + 交互（中心射线）
//
// 输入流：Binding(设备) → InputActions(语义) → 本模式 → 实体管线

import * as THREE from 'three';
import { FtxAsset } from '../vendor/player/FtxAsset';
import type { Asset } from '../vendor/player';
import { CharacterBase } from '../entity/CharacterBase';
import { EntityManager } from '../entity/EntityManager';
import { Player } from '../entity/Player';
import { EnemyBase } from '../entity/EnemyBase';
import { CameraController } from '../services/camera/CameraController';
import { Crosshair } from '../services/ui/Crosshair';
import { MapQuery } from '../services/map/MapQuery';
import { MapRender } from '../services/map/MapRender';
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import { RasterMap } from '../services/map/RasterMap';
import { Minimap } from '../services/ui/Minimap';
import type { InputActions } from '../platform/input/InputActions';
import { drainInteractions } from '../platform/input/InputActions';
import { aiSystem } from '../systems/ai/AISystem';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { PRESERVER_AI } from '../systems/ai/aiconfig';
import { BulletBase } from '../entity/BulletBase';
import { ItemBase } from '../entity/ItemBase';
import type { EntityBase } from '../entity/EntityBase';
import { createSolidBulletAsset } from '../services/fx/SolidBulletAsset';
import { aimRaycast } from '../services/combat/Targeting';

export class WorldMode {
  readonly entities: EntityManager;
  readonly player: Player;
  enemy: EnemyBase | null = null;
  private cameraCtrl: CameraController;
  private mapRender: MapRender;
  private map: MapQuery;
  private crosshair: Crosshair;
  private lastTapWorld: { x: number; y: number } | null = null;
  /** ★ 小地图（左上角；RasterMap 静态地形 → Minimap 渲染） */
  private minimap: Minimap;
  /** 噪点 3D 标记（验证小地图算法用） */
  private noiseMarks: THREE.Mesh[] = [];
  /** 测试子弹资产（程序生成发光圆点；正式资产就绪后替换） */
  private bulletAsset = createSolidBulletAsset();
  private bulletCooldown = 0;
  /** ★ 准星射线落点调试标记（红点显示瞄准落点） */
  private aimMarker: THREE.Mesh;
  /** ★ 准星射线可视化（摄像机 → 落点，青色） */
  private aimLine: THREE.Line;
  /** ★ 射击方向可视化（角色枪口 → 落点，橙色） */
  private shootLine: THREE.Line;
  /** AI 上下文（索敌 = 玩家位置） */
  private aiCtx: BehaviorContext = {
    dt: 0,
    time: 0,
    target: null,
    findTarget: () => null,
  };

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    asset: FtxAsset,
    map: MapQuery,
    physics: PhysicsWorld,
    enemyAsset?: Asset,
  ) {
    this.map = map;
    // ---- 实体管线（管理 + 物理 + 基类实例） ----
    this.entities = new EntityManager(physics);

    // 地面实体（固定碰撞体，匹配 64×64 地图；纯数据实体，无行为）
    // ★ 薄板顶面 = y0：物品/子弹落在地面上（物理支撑面）
    const b = map.getBounds();
    const center = (b.min + b.max) / 2;
    this.entities.create({
      kind: 'ground',
      x: center, y: -0.05, z: center,
      physics: { type: 'fixed', options: { shape: { type: 'cuboid', hx: 32, hy: 0.05, hz: 32 } } },
    });
    // ★ 地图边界物理墙（物品/子弹出界防护——物理自然挡住，无需代码钳制）
    const W = 1, H = 8, half = (b.max - b.min) / 2;
    const mkWall = (x: number, z: number, hx: number, hz: number) => {
      this.entities.create({
        kind: 'ground',
        x, y: H / 2, z,
        physics: { type: 'fixed', options: { shape: { type: 'cuboid', hx, hy: H / 2, hz } } },
      });
    };
    mkWall(b.min - W, center, W, half + W);           // 西
    mkWall(b.max + W, center, W, half + W);           // 东
    mkWall(center, b.min - W, half + W, W);           // 北
    mkWall(center, b.max + W, half + W, W);           // 南

    // ★ 主角（CharacterBase 实例：物理/动画/渲染全由基类联动）
    this.player = new Player(this.entities, scene, asset, {
      x: center, y: 0, z: center,
      animMap: {
        states: {
          idle: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
          walk: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
          attack: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
        },
        fps: { idle: 2, walk: 6, attack: 8 },
      },
      moveSpeed: 2.5,
      facing: '后',
    });

    // ---- 地图视觉（3D 地形网格，当前平地占位） ----
    this.mapRender = new MapRender(scene, map);

    // ---- ★ 测试物品（程序图标圆点；走近拾取验证，后续接配置表/背包） ----
    // 生成位置 = 地面高度（实体 y = 底部贴地；球心自动 = y + 半径）
    const itemIcons = [
      createSolidBulletAsset(64, 0.05, 0.85, 0.6), // 绿
      createSolidBulletAsset(64, 0.12, 0.9, 0.55), // 黄
      createSolidBulletAsset(64, 0.85, 0.8, 0.5),  // 紫
    ];
    for (let i = 0; i < itemIcons.length; i++) {
      const item = new ItemBase(this.entities, scene, itemIcons[i], {
        x: center + 6 + i * 2.5,
        y: map.getHeight(center + 6 + i * 2.5, center + 6),
        z: center + 6,
        itemId: `test_item_${i + 1}`,
        displayName: `测试物品${i + 1}`,
        physical: true,
      });
      item.onPickup = (it, picker) => {
        console.log(`[拾取] ${picker.constructor.name} 拾取了「${it.displayName}」(${it.itemId})`);
        return true;
      };
    }

    // ---- ★ 测试敌人（普瑞赛斯：特效包 + AI 配置驱动） ----
    if (enemyAsset) {
      this.enemy = new EnemyBase(this.entities, scene, enemyAsset, {
        x: center + 12,
        y: 0,
        z: center + 8,
        animMap: {
          states: {
            idle: { 前: ['前'], 后: ['后'] },
            walk: { 前: ['前'], 后: ['后'] },
            attack: { 前: ['前'], 后: ['后'] },
          },
          fps: { idle: 1, walk: 1, attack: 1 },
        },
        facing: '前',
        aggressive: true,
        aiConfig: PRESERVER_AI,
      }, camera);
      // ★ 贴片世界朝向（绕 Y 旋转跟随移动方向）；显示帧/转身由相机判定（EnemyBase.onUpdate）
      this.enemy.billboard = false;
    }

    // ---- 相机（独立模块） ----
    this.cameraCtrl = new CameraController(camera);

    // ---- 准星（固定屏幕中心，瞄准/交互基准） ----
    this.crosshair = new Crosshair();

    // ---- ★ 小地图（RasterMap 光栅化静态地形 → Minimap 左上角绘制） ----
    const raster = new RasterMap(map, 12345);
    this.minimap = new Minimap(raster);

    // ---- ★ 噪点 3D 标记（与小地图同一 seed/算法 → 一一对应，验证滚动/位置） ----
    let noiseSeed = 12345;
    const noiseRnd = () => (noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const noiseCount = Math.floor(raster.size * raster.size * 0.05);
    const markGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const markMat = new THREE.MeshBasicMaterial({ color: 0xffdd55 });
    for (let i = 0; i < noiseCount; i++) {
      const x = Math.floor(noiseRnd() * raster.size);
      const z = Math.floor(noiseRnd() * raster.size);
      const mark = new THREE.Mesh(markGeo, markMat);
      mark.position.set(x + 0.5, 0.2, z + 0.5);
      scene.add(mark);
      this.noiseMarks.push(mark);
    }

    // ---- ★ 瞄准落点调试标记（红点：摄像机 → 准星射线的落点） ----
    this.aimMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.9 }),
    );
    scene.add(this.aimMarker);

    // ---- ★ 瞄准可视化线：准星射线（摄像机→落点，青色）+ 射击方向（枪口→落点，橙色） ----
    this.aimLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x44ccff, transparent: true, opacity: 0.55 }),
    );
    this.shootLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.8 }),
    );
    this.aimLine.visible = false;
    this.shootLine.visible = false;
    scene.add(this.aimLine, this.shootLine);
  }

  /** 每帧驱动（输入 → 相机 → 实体管线 → AI → 交互） */
  update(dt: number, input: InputActions, attackPressed: boolean, look: { x: number; y: number }, zoom: number): void {
    const pp = this.player.controllerPosition;

    // ★ 小地图每帧更新（三层：地面/实体/黑雾；实体点从管线同步）
    //   物品 moving = 物理速度 > 阈值（移动中的物品不显示）
    const miniEntities = this.entities.allBases().map((b) => {
      let moving: boolean | undefined;
      if (b.entity.kind === 'item' && b.entity.rigidBody && this.entities.physics) {
        const v = this.entities.physics.getLinearVelocity(b.entity.rigidBody.handle);
        moving = Math.hypot(v.x, v.z) > 0.1;
      }
      return { x: b.position.x, z: b.position.z, kind: b.entity.kind, moving };
    });
    this.minimap.update(pp.x, pp.y, miniEntities);

    // AI 上下文（本帧 dt/累计时间 + 索敌 = 玩家位置）
    this.aiCtx.dt = dt;
    this.aiCtx.time += dt;
    this.aiCtx.findTarget = () => ({ x: pp.x, z: pp.y });

    // ★ 玩家 y 由物理读回（重力/被顶起真实可见）——模式层不再钉死
    // 相机高度 = 玩法高度（地形+跳跃），不跟随物理 y 浮动（否则撞人时相机猛跳"错位"）
    const groundY = this.map.getHeight(pp.x, pp.y);
    this.cameraCtrl.update(dt, look, zoom, {
      x: pp.x,
      y: 0,
      z: pp.y,
      height: groundY,
      jump: this.player.jumpHeight,
    }, this.player.controller.isMoving);
    this.player.visible = !this.cameraCtrl.isFirstPerson;

    // ---- ★ 瞄准落点调试（红点 + 射线线 + 射击方向线） ----
    const aim = this.aimRaycast();
    if (aim) {
      this.aimMarker.visible = true;
      this.aimMarker.position.set(aim.x, aim.y, aim.z);
      // 准星射线：摄像机 → 落点
      this.setLine(this.aimLine, [
        this.camera.position.x, this.camera.position.y, this.camera.position.z,
        aim.x, aim.y, aim.z,
      ]);
      // 射击方向：角色枪口 → 落点
      const p = this.player.position;
      this.setLine(this.shootLine, [
        p.x, p.y + 1.1, p.z,
        aim.x, aim.y, aim.z,
      ]);
    } else {
      this.aimMarker.visible = false;
      this.aimLine.visible = false;
      this.shootLine.visible = false;
    }

    // ---- AI 驱动（敌人自主行为；★ 在实体管线之前：本帧方向本帧生效，移动零滞后） ----
    aiSystem.updateAll(dt, this.aiCtx);

    // ---- 实体管线驱动（攻击由模式层转发，输入/相机坐标系传入） ----
    if (attackPressed) this.player.attack();
    this.entities.update(dt, input, this.cameraCtrl.getFrame());

    // ---- ★ 玩家发射（左键：单次按下立即一发；长按 = 间隔持续发射） ----
    this.bulletCooldown -= dt;
    if (this.bulletCooldown <= 0 && (input.held.attack || attackPressed)) {
      this.bulletCooldown = 0.15;
      this.firePlayerBullet();
    }

    // ---- ★ 角色位置控制（kinematic：位置 = 代码；y 地形 + xz 边界）
    //         纯数据操作，无刚体同步（刚体由 syncPhysics 驱动） ----
    this.clampCharacter(this.player);
    if (this.enemy) this.clampCharacter(this.enemy);

    // ---- 交互消费（★ 以准星为基准：中心射线，与设备解耦） ----
    const rayNdc = new THREE.Vector2(0, 0);
    const raycast = new THREE.Raycaster();
    for (const it of drainInteractions(input)) {
      if (it.type === 'tap') {
        raycast.setFromCamera(rayNdc, this.camera);
        const hit = new THREE.Vector3();
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        if (raycast.ray.intersectPlane(plane, hit)) {
          this.lastTapWorld = { x: hit.x, y: hit.z };
        }
      }
    }
  }

  /** ★ 准星射线查询（公共瞄准服务：实体优先 → 物理兜底，见 services/combat/Targeting） */
  private aimRaycast(): { x: number; y: number; z: number } | null {
    this.camera.updateMatrixWorld();
    const rayDir = new THREE.Vector3();
    this.camera.getWorldDirection(rayDir);
    const cam = this.camera.position;
    const hit = aimRaycast(this.entities, {
      origin: { x: cam.x, y: cam.y, z: cam.z },
      dir: { x: rayDir.x, y: rayDir.y, z: rayDir.z },
      maxDist: 200,
      exclude: this.player,
    });
    return hit ? hit.point : null;
  }

  /** ★ 玩家发射（TPS 标准）：
   *   ① 摄像机沿准星方向发一条射线 → 落点（命中目标实体/地面，排除玩家自身）
   *   ② 角色枪口 → 落点 = 发射方向（3D：带俯仰） */
  private firePlayerBullet(): void {
    const p = this.player.position;
    const muzzle = { x: p.x, y: p.y + 1.1, z: p.z }; // 枪口
    // ① 准星射线 → 落点
    const aim = this.aimRaycast();
    let tx: number, ty: number, tz: number;
    if (aim) {
      tx = aim.x; ty = aim.y; tz = aim.z;
    } else {
      this.camera.updateMatrixWorld();
      const rayDir = new THREE.Vector3();
      this.camera.getWorldDirection(rayDir);
      const cam = this.camera.position;
      tx = cam.x + rayDir.x * 200; ty = cam.y + rayDir.y * 200; tz = cam.z + rayDir.z * 200;
    }
    // ② 枪口 → 落点（3D 方向）
    const dx = tx - muzzle.x, dy = ty - muzzle.y, dz = tz - muzzle.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    new BulletBase(this.entities, this.scene, this.bulletAsset, {
      x: muzzle.x + (dx / len) * 0.8,
      y: muzzle.y + (dy / len) * 0.8,
      z: muzzle.z + (dz / len) * 0.8,
      dirX: dx / len,
      dirY: dy / len,
      dirZ: dz / len,
      speed: 12,
      camp: 'player',
      lifetime: 2,
    });
  }

  /** ★ 更新一条可视化线（6 个浮点 = 2 点 × xyz） */
  private setLine(line: THREE.Line, pts: number[]): void {
    const geo = line.geometry as THREE.BufferGeometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.computeBoundingSphere();
    line.visible = true;
  }

  /** 渲染：实体管线遍历画 + 地图 + 场景 */
  render(renderer: THREE.WebGLRenderer): void {
    this.entities.renderAll(this.camera);
    renderer.render(this.scene, this.camera);
  }

  /** ★ 角色位置控制（kinematic）：y = 地形高度 + xz 地图边界。
   *   纯位置数据（刚体由 EntityBase.syncPhysics 驱动），无任何物理修正 */
  private clampCharacter(e: CharacterBase): void {
    const p = e.position;
    const b = this.map.getBounds();
    p.x = Math.max(b.min, Math.min(b.max, p.x));
    p.z = Math.max(b.min, Math.min(b.max, p.z));
    p.y = this.map.getHeight(p.x, p.z);
  }

  get playerPosition(): { x: number; y: number } {
    return this.player.controllerPosition;
  }

  get playerState(): string {
    return this.player.controller.state;
  }

  get playerFacing(): string {
    return this.player.anim!.state.facing;
  }

  get playerFlipX(): boolean {
    return this.player.anim!.state.flipX;
  }

  get frameIndex(): number {
    return this.player.anim!.state.frameIndex;
  }

  get lastTap(): { x: number; y: number } | null {
    return this.lastTapWorld;
  }

  dispose(): void {
    this.entities.clear();
    this.mapRender.dispose();
    this.crosshair.dispose();
    this.minimap.dispose();
    // 噪点标记（共享几何/材质，只移除 mesh）
    for (const m of this.noiseMarks) {
      this.scene.remove(m);
    }
    this.noiseMarks = [];
    // ★ 瞄准调试（红点 + 两条线）
    this.aimMarker.geometry.dispose();
    (this.aimMarker.material as THREE.Material).dispose();
    this.scene.remove(this.aimMarker);
    this.aimLine.geometry.dispose();
    (this.aimLine.material as THREE.Material).dispose();
    this.scene.remove(this.aimLine);
    this.shootLine.geometry.dispose();
    (this.shootLine.material as THREE.Material).dispose();
    this.scene.remove(this.shootLine);
  }
}
