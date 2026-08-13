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
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import { RasterMap, chunkKeyOf } from '../services/map/RasterMap';
import { CHUNK_SIZE, BLOCK_SIZE } from '../services/map/ChunkGenerator';
import { Minimap } from '../services/ui/Minimap';
import type { InputActions } from '../platform/input/InputActions';
import { aiSystem } from '../systems/ai/AISystem';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { PRESERVER_AI } from '../systems/ai/aiconfig';
import { ItemBase } from '../entity/ItemBase';
import type { EntityBase } from '../entity/EntityBase';
import { createSolidBulletAsset } from '../services/fx/SolidBulletAsset';
import { aimRaycast } from '../services/combat/Targeting';
import { BulletManager } from '../services/combat/BulletManager';
import { executeAttack } from '../services/combat/Attack';

export class WorldMode {
  readonly entities: EntityManager;
  readonly player: Player;
  enemy: EnemyBase | null = null;
  private cameraCtrl: CameraController;
  /** ★ 统一空间层（无限 chunk 地图：地形 + 实体索引 + 梯形剔除；架构 3.8/3.10） */
  private raster: RasterMap;
  private crosshair: Crosshair;
  /** ★ 小地图（左上角；RasterMap 地形 → Minimap 渲染） */
  private minimap: Minimap;
  /** 测试子弹资产（程序生成发光圆点；正式资产就绪后替换） */
  private bulletAsset = createSolidBulletAsset();
  /** ★ 子弹池（预创建 100 颗反复使用；超时回池，不销毁重建） */
  private bullets: BulletManager;
  private bulletCooldown = 0;
  /** chunk 视觉网格（chunkKey → Mesh；天内只增不删，天结束统一回收） */
  private chunkMeshes = new Map<number, THREE.Mesh>();
  /** chunk 地面碰撞刚体（chunkKey → 实体 id；trimesh 复用视觉网格几何；
   *   天内只增不删，天结束统一回收） */
  private chunkBodies = new Map<number, number>();
  /** chunk 共享材质（顶点色：块类型着色——高台沙黄/平地绿/坑洞黑） */
  private static chunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  /** AI 上下文（索敌 = 玩家位置 + 攻击意图 = 统一攻击管线） */
  private aiCtx: BehaviorContext = {
    dt: 0,
    time: 0,
    target: null,
    findTarget: () => null,
    attack: () => undefined,
  };
  /** ★ 玩家出生/摔死传送点（出生安全区：ChunkGenerator 强制平地） */
  private readonly spawnPoint = { x: CHUNK_SIZE / 2, z: CHUNK_SIZE / 2 };

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    asset: FtxAsset,
    physics: PhysicsWorld,
    enemyAsset?: Asset,
  ) {
    // ---- ★ 统一空间层（初始 3×3 chunk，玩家驱动扩张；架构 3.8） ----
    this.raster = new RasterMap();
    // ---- 实体管线（管理 + 物理 + 基类实例） ----
    this.entities = new EntityManager(physics, this.raster);

    // 玩家出生 = 中心 chunk 中心（(30,30)，3×3 初始世界 [-60,120)² 正中央）
    const spawn = this.spawnPoint;

    // ---- ★ 初始 3×3 chunk 的地面刚体 + 视觉网格（后续 chunk 由 updateChunks 扩张） ----
    this.syncChunks(spawn.x, spawn.z);

    // ★ 主角（CharacterBase 实例：物理/动画/渲染全由基类联动）
    this.player = new Player(this.entities, scene, asset, {
      x: spawn.x, y: 0, z: spawn.z,
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

    // ---- ★ 测试物品（程序图标圆点；走近拾取验证，后续接配置表/背包） ----
    // 生成位置 = 地面高度（实体 y = 底部贴地）
    const itemIcons = [
      createSolidBulletAsset(64, 0.05, 0.85, 0.6), // 绿
      createSolidBulletAsset(64, 0.12, 0.9, 0.55), // 黄
      createSolidBulletAsset(64, 0.85, 0.8, 0.5),  // 紫
    ];
    for (let i = 0; i < itemIcons.length; i++) {
      const item = new ItemBase(this.entities, scene, itemIcons[i], {
        x: spawn.x + 6 + i * 2.5,
        y: this.raster.surfaceHeightAt(spawn.x + 6 + i * 2.5, spawn.z + 6),
        z: spawn.z + 6,
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
        x: spawn.x + 12,
        y: 0,
        z: spawn.z + 8,
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

    // ---- ★ 小地图（RasterMap 光栅化地形 → Minimap 左上角绘制） ----
    this.minimap = new Minimap(this.raster);

    // ---- ★ 子弹池（100 颗常驻复用） ----
    this.bullets = new BulletManager(this.entities, scene, this.bulletAsset, 100);
    // ★ AI 攻击意图 = 统一攻击管线（近战/远程/范围分派 → 伤害管线）
    this.aiCtx.attack = (opts) => executeAttack(this.entities, this.bullets, opts);
  }

  /** 每帧驱动（输入 → 相机 → 实体管线 → AI → 交互） */
  update(dt: number, input: InputActions, attackPressed: boolean, look: { x: number; y: number }, zoom: number): void {
    const pp = this.player.controllerPosition;

    // ★ 无限地图扩张（玩家跨 chunk → 新 chunk 加载：数据 + 地面刚体 + 视觉网格）
    this.syncChunks(pp.x, pp.y);

    // ★ 小地图每帧更新（三层：地面/实体/黑雾；玩家居中 + 箭头=摄像机朝向）
    this.minimap.update(pp.x, pp.y, this.cameraCtrl.worldYaw, this.entities.allBases());

    // AI 上下文（本帧 dt/累计时间 + 索敌 = 玩家位置 + 攻击发射 = 子弹管线）
    this.aiCtx.dt = dt;
    this.aiCtx.time += dt;
    this.aiCtx.findTarget = () => ({ x: pp.x, z: pp.y });

    // ---- AI 驱动（敌人自主行为；★ 在实体管线之前：本帧方向本帧生效，移动零滞后） ----
    aiSystem.updateAll(dt, this.aiCtx);

    // ---- 实体管线驱动（攻击由模式层转发，输入/相机坐标系传入） ----
    if (attackPressed) this.player.attack();
    this.entities.update(dt, input, this.cameraCtrl.getFrame());

    // ---- ★ 角色位置控制（kinematic：位置 = 代码；y 平滑过渡地形高度）
    //         ★ 先于相机更新：相机用本帧玩家 y → 上高台/下落相机实时跟随，不嵌立面 ----
    this.clampCharacter(this.player, dt);
    if (this.enemy) this.clampCharacter(this.enemy, dt);

    // ---- 相机（跟随玩家实际脚底高度：爬升/掉落平滑时相机同样平滑） ----
    this.cameraCtrl.update(dt, look, zoom, {
      x: this.player.position.x,
      y: 0,
      z: this.player.position.z,
      height: this.player.position.y,
      jump: this.player.jumpHeight,
    }, this.player.controller.isMoving);
    this.player.visible = !this.cameraCtrl.isFirstPerson;

    // ---- ★ 玩家发射（左键：单次按下立即一发；长按 = 间隔持续发射） ----
    this.bulletCooldown -= dt;
    if (this.bulletCooldown <= 0 && (input.held.attack || attackPressed)) {
      this.bulletCooldown = 0.15;
      this.firePlayerBullet();
    }
  }

  /** ★ 相机准星射线（公共：瞄准检测/发射兜底共用，避免重复计算） */
  private cameraRay(): { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } } {
    this.camera.updateMatrixWorld();
    const rayDir = new THREE.Vector3();
    this.camera.getWorldDirection(rayDir);
    const cam = this.camera.position;
    return {
      origin: { x: cam.x, y: cam.y, z: cam.z },
      dir: { x: rayDir.x, y: rayDir.y, z: rayDir.z },
    };
  }

  /** ★ 准星射线查询（公共瞄准服务：实体优先 → 物理兜底，见 services/combat/Targeting） */
  private aimRaycast(): { x: number; y: number; z: number } | null {
    const ray = this.cameraRay();
    const hit = aimRaycast(this.entities, {
      origin: ray.origin,
      dir: ray.dir,
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
    // ① 准星射线 → 落点（aimRaycast 内部已算相机射线，无命中 → 远处兜底）
    const aim = this.aimRaycast();
    let tx: number, ty: number, tz: number;
    if (aim) {
      tx = aim.x; ty = aim.y; tz = aim.z;
    } else {
      const ray = this.cameraRay();
      tx = ray.origin.x + ray.dir.x * 200;
      ty = ray.origin.y + ray.dir.y * 200;
      tz = ray.origin.z + ray.dir.z * 200;
    }
    // ② 枪口 → 落点（3D 方向）
    const dx = tx - muzzle.x, dy = ty - muzzle.y, dz = tz - muzzle.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    // ★ 玩家射击 = 统一攻击管线（projectile 意图）
    executeAttack(this.entities, this.bullets, {
      type: 'projectile',
      source: this.player,
      x: muzzle.x + (dx / len) * 0.8,
      y: muzzle.y + (dy / len) * 0.8,
      z: muzzle.z + (dz / len) * 0.8,
      dirX: dx / len,
      dirY: dy / len,
      dirZ: dz / len,
      speed: 12,
      camp: 'player',
      lifetime: 2,
      damage: 10, // ★ 穿透伤害（敌人 30 血 → 3 发）
    });
  }

  /** 渲染：实体管线遍历画 + 地图 + 场景 */
  render(renderer: THREE.WebGLRenderer): void {
    this.entities.renderAll(this.camera);
    renderer.render(this.scene, this.camera);
  }

  /** ★ 无限地图 chunk 同步：数据（RasterMap）+ 地面刚体 + 视觉网格。
   *   天内只增不删；天结束（dispose/clearAll）统一回收
   *   ★ 边界严丝合缝由生成约束保证（边界 region 强制平地），无需修补 */
  private syncChunks(px: number, pz: number): void {
    const added = this.raster.updateChunks(px, pz);
    // ★ ① 新增 chunk：视觉网格（trimesh 碰撞体随网格几何同源创建，见 buildChunkMesh）
    for (const { cx, cz } of added) {
      this.buildChunkMesh(cx, cz);
    }
    // ★ ② 新增 chunk 的已存在邻居：网格重建——
    //   网格顶点高度 = 世界采样（跨 chunk），生成时邻 chunk 未加载 → 边界
    //   顶点高度被写成 0（heightAt 兜底）→ 视觉边界低带。
    //   邻居加载后必须重建旧网格。
    for (const { cx, cz } of added) {
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nkey = chunkKeyOf(cx + nx, cz + nz);
        if (this.chunkMeshes.has(nkey)) {
          this.rebuildChunkMesh(cx + nx, cz + nz);
        }
      }
    }
  }

  /** 建/重建 chunk 视觉网格（高度场 + 顶点色 + 跨 chunk 法线）；
   *   ★ 视觉/物理同源：同一几何 → mesh 渲染 + trimesh 固定碰撞体
   *   （子弹/物品贴起伏面滚动、撞高台立面——无需手工碰撞体） */
  private buildChunkMesh(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    if (this.chunkMeshes.has(key)) return;
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const normals = new Float32Array(pos.count * 3);
    const tmpN = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) + CHUNK_SIZE / 2;
      // ★ 局部 z 直接用旋转后坐标（+30 平移）——此前用 -getZ 导致高度场沿 z 镜像
      //   （顶点实际在 z=0 却采样 z=60 的高度 → 高台/坑洞图案全部错位）
      const lz = pos.getZ(i) + CHUNK_SIZE / 2;
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      // ★ 顶点高度 = 视觉面顶点值（2×2 格 max，地图层统一函数）——
      //   直角立面：数据二值（块内 1.5/块外 0），单格采样时块边界顶点=0
      //   → 视觉斜坡 → 角色站在视觉斜坡上方悬空；max 采样取台面高
      const h = this.raster.vertexHeightAt(wx, wz);
      pos.setY(i, h);
      const [r, g, b] = this.raster.terrainColorAt(wx, wz);
      colors[i * 3] = r / 255;
      colors[i * 3 + 1] = g / 255;
      colors[i * 3 + 2] = b / 255;
      // ★ 手动法线：世界高度采样（跨 chunk）→ 边界法线连续（无光照接缝）
      const hL = this.raster.heightAt(wx - 1, wz);
      const hR = this.raster.heightAt(wx + 1, wz);
      const hD = this.raster.heightAt(wx, wz - 1);
      const hU = this.raster.heightAt(wx, wz + 1);
      tmpN.set(hL - hR, 2, hD - hU).normalize();
      normals[i * 3] = tmpN.x;
      normals[i * 3 + 1] = tmpN.y;
      normals[i * 3 + 2] = tmpN.z;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const mesh = new THREE.Mesh(geo, WorldMode.chunkMat);
    mesh.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.chunkMeshes.set(key, mesh);

    // ---- ★ 碰撞体 = 视觉网格几何（顶点已含高度，本地坐标 + mesh 同位置）----
    if (!this.chunkBodies.has(key)) {
      const verts = pos.array as Float32Array;
      const idx = new Uint32Array(geo.index!.array); // rapier 需要 Uint32Array（three 可能 Uint16）
      const body = this.entities.create({
        kind: 'ground',
        x: mesh.position.x,
        y: 0,
        z: mesh.position.z,
        physics: {
          type: 'fixed',
          options: {
            shape: { type: 'trimesh', vertices: verts, indices: idx },
          },
        },
      });
      this.chunkBodies.set(key, body.id);
    }
  }

  /** 重建 chunk 网格（邻居加载后：移除旧 mesh → 重建；
   *   ★ 碰撞体同步重建——旧 trimesh 顶点是"邻居未加载"时的数据，必须与视觉一致） */
  private rebuildChunkMesh(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    const old = this.chunkMeshes.get(key);
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      this.chunkMeshes.delete(key);
    }
    const oldBody = this.chunkBodies.get(key);
    if (oldBody !== undefined) {
      this.entities.destroy(oldBody);
      this.chunkBodies.delete(key);
    }
    this.buildChunkMesh(cx, cz);
  }

  /** ★ 天结束统一回收（世界重建：raster 重置 3×3 + chunk 网格/刚体清理） */
  resetDay(): void {
    this.raster.clearAll();
    for (const m of this.chunkMeshes.values()) {
      this.scene.remove(m);
      m.geometry.dispose(); // ★ 显式释放 GPU 缓冲（three 不会随 GC 自动释放）
    }
    this.chunkMeshes.clear();
    // ★ 碰撞刚体从物理世界移除（trimesh；防泄漏/重复）
    for (const id of this.chunkBodies.values()) {
      this.entities.destroy(id);
    }
    this.chunkBodies.clear();
    this.syncChunks(this.player.position.x, this.player.position.z);
  }

  /** ★ 角色垂直运动（kinematic：模式层驱动）：
   *   - 爬升：限速趋近（攀爬 3m/s；平地跟随 7.5m/s）
   *   - 下落：普通限速下落 25m/s（无假重力/无状态——下坡最简单代码）
   *   - ★ 高台攀爬：y 未达台面高度前 x/z 被挡在块外（贴边爬升，不埋进
   *     立面刚体）；达标后沿进入边跨上台面
   *   - 坑洞：限速下落 → 触底 → 摔死（玩家传送回出生点；敌人销毁置空） */
  private clampCharacter(e: CharacterBase, dt: number): void {
    const p = e.position;
    const targetY = this.groundHeightAt(e);
    if (targetY >= -1.5) {
      let target = targetY;
      if (e.climbTargetY > 0) {
        // ★ 攀爬中
        if (p.y >= e.climbTargetY - 0.05) {
          // 达标：沿进入边跨入块内（越过立面刚体，站上台面）
          // step = 末端贴边缓冲 ~0.15 + 块内深度 0.4
          const step = 0.55;
          if (e.climbEdge === 'l') p.x = e.climbBlockX * BLOCK_SIZE + step;
          else if (e.climbEdge === 'r') p.x = (e.climbBlockX + 1) * BLOCK_SIZE - step;
          else if (e.climbEdge === 'u') p.z = e.climbBlockZ * BLOCK_SIZE + step;
          else p.z = (e.climbBlockZ + 1) * BLOCK_SIZE - step;
          p.y = e.climbTargetY;
          e.climbTargetY = 0; // 完成：清除攀爬状态
          target = this.raster.surfaceHeightAt(p.x, p.z);
        } else {
          // 未达标：沿【固定进入边】推回贴边爬升（★ 不每帧重算最近边——
          //   斜贴边时最近边在 l/r/u/d 间切换 → 推回位置横跳 → 高频闪动）
          target = e.climbTargetY;
          this.pushToClimbEdge(e);
        }
      } else if (targetY - p.y > 0.5) {
        // ★ 潜在攀爬：脚底中心必须真实踩进高台块才触发（贴边走/路过时
        //   脚底圆采样触边不算——否则贴台边走会被反复吸上台）
        const bx = Math.floor(p.x / BLOCK_SIZE);
        const bz = Math.floor(p.z / BLOCK_SIZE);
        const centerBlockY = this.raster.surfaceHeightAt(bx * BLOCK_SIZE + BLOCK_SIZE / 2, bz * BLOCK_SIZE + BLOCK_SIZE / 2);
        if (centerBlockY - p.y > 0.5) {
          // ★ 触发攀爬：前方高台（高度差 > 0.5m；微起伏 ±0.2 不触发）
          e.climbTargetY = centerBlockY;
          e.climbBlockX = bx;
          e.climbBlockZ = bz;
          e.climbEdge = this.nearestEdgeOf(e, bx, bz);
          this.pushToClimbEdge(e);
          target = e.climbTargetY;
        } else {
          // 路过贴边：y 保持（不吸高、不攀爬），等角色真正进块或离开
          target = p.y;
        }
      }
      // ★ 统一限速趋近：爬升（攀爬 3m/s / 平地 7.5m/s）、下落 25m/s——
      //   出边即落（1.5m ≈ 0.06s，几乎即时贴地，无"虚空飘落"）
      const dy = target - p.y;
      const riseRate = e.climbTargetY > 0 ? 3 : 7.5;
      if (dy > 0) p.y += Math.min(dy, riseRate * dt);
      else p.y += Math.max(dy, -25 * dt);
      return;
    }
    // 坑洞：限速下落 → 触底 → 摔死（一次性）
    p.y += Math.max(targetY - p.y, -25 * dt);
    if (p.y <= targetY + 0.05) {
      e.climbTargetY = 0;
      e.onDeath(null);
      if (e === this.player) {
        // 玩家：传送回出生点（出生安全区，强制平地 → 不循环死亡）
        p.x = this.spawnPoint.x;
        p.z = this.spawnPoint.z;
        p.y = this.raster.surfaceHeightAt(p.x, p.z);
        this.cameraCtrl.snapTo(p.x, p.y, p.z);
      } else {
        this.enemy = null;
      }
    }
  }

  /** ★ 前瞻式地面采样（移动方向感知）：
   *   ├ 静止：只取中心——站台边（中心出块）→ 掉，不悬空站虚空
   *   ├ 移动：只取前瞻点（中心 + 移动方向 × 0.25）：
   *   │   ├ 走下高台：前瞻点一出块即判低地 → 立即下落（不等中心出块）
   *   │   ├ 贴边走：前瞻点沿边仍在台上 → 保持（防抖：y 不震荡）
   *   │   ├ 走向高台：前瞻点入块 → 触发攀爬
   *   │   └ 斜朝外/拐过块角：前瞻点出块 → 掉（自然，微朝外即下台）
   *   └ ★ 采样用 surfaceHeightAt（与视觉网格同一插值函数）→ 角色脚底
   *     永贴视觉面（不陷地） */
  private groundHeightAt(e: CharacterBase): number {
    const p = e.position;
    const m = e.controller.moveDir; // { x, y } 其中 y = 世界 z（玩法命名）
    if (m.x === 0 && m.y === 0) return this.raster.surfaceHeightAt(p.x, p.z);
    return this.raster.surfaceHeightAt(p.x + m.x * 0.25, p.z + m.y * 0.25);
  }

  /** ★ 攀爬块的最近边（触发攀爬时判定一次：角色进块时离哪条边最近） */
  private nearestEdgeOf(e: CharacterBase, bx: number, bz: number): 'l' | 'r' | 'u' | 'd' {
    const p = e.position;
    const dl = p.x - bx * BLOCK_SIZE;
    const dr = (bx + 1) * BLOCK_SIZE - p.x;
    const du = p.z - bz * BLOCK_SIZE;
    const dd = (bz + 1) * BLOCK_SIZE - p.z;
    const minD = Math.min(dl, dr, du, dd);
    if (minD === dl) return 'l';
    if (minD === dr) return 'r';
    if (minD === du) return 'u';
    return 'd';
  }

  /** ★ 沿攀爬块的固定边推回（贴边爬升，防埋进立面）。
   *   ★ 缓冲随爬升进度收缩 0.6 → 0.15（边升边贴近墙——斜向轨迹，
   *   避免纯垂直"电梯式"爬升）：
   *   起点 0.6 = 贴片半宽 0.5 + 深度安全余量；末端 0.15 = 仅防插墙 */
  private pushToClimbEdge(e: CharacterBase): void {
    const p = e.position;
    const bx = e.climbBlockX;
    const bz = e.climbBlockZ;
    const progress = Math.min(1, Math.max(0, p.y / Math.max(0.1, e.climbTargetY)));
    const push = 0.6 - 0.45 * progress;
    if (e.climbEdge === 'l') p.x = bx * BLOCK_SIZE - push;
    else if (e.climbEdge === 'r') p.x = (bx + 1) * BLOCK_SIZE + push;
    else if (e.climbEdge === 'u') p.z = bz * BLOCK_SIZE - push;
    else p.z = (bz + 1) * BLOCK_SIZE + push;
  }

  dispose(): void {
    // ★ 地形碰撞体先移出物理世界（trimesh）
    for (const id of this.chunkBodies.values()) {
      this.entities.destroy(id);
    }
    this.chunkBodies.clear();
    this.entities.clear();
    this.crosshair.dispose();
    this.minimap.dispose();
    this.bullets.dispose();
    // chunk 视觉网格（天内统一回收）
    for (const m of this.chunkMeshes.values()) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.chunkMeshes.clear();
  }
}
