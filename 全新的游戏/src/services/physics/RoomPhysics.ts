// ============================================================
// RoomPhysics —— 房间（基地/舰内）的**可推家具物理**（2026-09-16）
// ============================================================
// 用户定调：「既然用了 rapier，家具就该能到处乱推」，且"小车也要有物理实体"。
//
// 设计（低风险混合式，不推翻既有的行走/边界逻辑）：
//   · 房间建好后把"家具 mesh"按**互相接触**聚成簇（union-find on AABB）——
//     一簇 = 一个 dynamic 刚体 + 多个盒碰撞体（部件各自带偏移）+ 一个 THREE.Group。
//     部件挂进 Group 后仍保持原来的相对位置 → 推动时整件家具一起走，不会散架。
//   · 每帧 `step()` 后用刚体位姿驱动 Group（mesh 跟随）；同时把每簇的
//     世界 AABB 刷回 BaseScene.solids → 角色/访客的"挡路判定"永远跟着家具走。
//   · 角色不改成物理体：走动仍走原来的逐轴拒绝逻辑；**推挤**靠
//     `pushAt()` —— 与角色圆相交的簇被施加冲量（无扭矩 → 家具平移不翻倒）。
//   · 静态围栏（地面 + 四面墙）保证家具不会被推出房间。
//   · 运动学道具（AGV 小车 / 行车吊箱）：每帧把动画位置写进 kinematic 刚体，
//     rapier 自动让它推动沿途的 dynamic 家具（"小车撞开货箱"）。
//
// 生命周期：BaseScene 建房间时 new、dispose 时释放。

import * as THREE from 'three';
import { PhysicsWorld } from './PhysicsWorld';

/** 能被物理驱动的"一簇家具" */
interface Cluster {
  id: number;
  group: THREE.Group;
  /** 各部件相对簇中心的盒半长（用于刷新世界 AABB） */
  parts: { hx: number; hy: number; hz: number; cx: number; cy: number; cz: number }[];
  /** 簇的半长（并集，供 AABB 刷新） */
  half: THREE.Vector3;
  /** 初始中心 */
  center: THREE.Vector3;
  /** 初始并集盒（视觉跟随件的归属判定用一次） */
  box: THREE.Box3;
}

/** 运动学道具（动画驱动 + 推动别人） */
export interface KineticMover {
  /** 当前中心位置（房间坐标） */
  at: (t: number) => { x: number; y: number; z: number };
  hx: number;
  hy: number;
  hz: number;
}

/** 暴露给 BaseScene 的实心盒（xz AABB；家具推动后会刷新） */
export interface SolidBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const FURNITURE_DENSITY = 20;   // 轻一点（大件也不会变成几吨）
const FURNITURE_DAMPING = 3.0;  // 停下得快，不滑来滑去
/** ★ 推挤速度（m/s）：**直接给速度**而不是施冲量 ——
 *  冲量要打赢"摩擦 + 重力"（μ·m·g 动辄几千牛），小冲量根本推不动；
 *  给速度则与质量无关，手感稳定（角色以这个速度把家具顶走）。 */
const PUSH_SPEED = 1.6;
const CLUSTER_MARGIN = 0.12;    // 部件"算接触"的间距

export class RoomPhysics {
  private world = new PhysicsWorld({ x: 0, y: -22, z: 0 });
  private clusters: Cluster[] = [];
  private kinetic: { id: number; mover: KineticMover }[] = [];
  private acc = 0;
  private readonly stepDt = 1 / 60;
  private _box = new THREE.Box3();
  private _q = new THREE.Quaternion();
  private _v = new THREE.Vector3();
  private _ext = new THREE.Vector3();

  /** ★ 把一批家具 mesh 聚簇 → 建 dynamic 刚体 + Group（成员原样保留相对位置）。
   *  @param parent    簇 Group 的挂载点（房间 root）
   *  @param followers 纯视觉跟随件（接触阴影等）：不进碰撞体，但跟着所在簇一起走 */
  addFurniture(meshes: THREE.Mesh[], parent: THREE.Object3D, followers: THREE.Mesh[] = []): void {
    // ---- ① 收集每个 mesh 的世界 AABB（房间坐标 = root 局部坐标） ----
    const items = meshes.map((mesh) => {
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      mesh.updateWorldMatrix(true, false);
      const box = (geo.boundingBox as THREE.Box3).clone().applyMatrix4(mesh.matrixWorld);
      mesh.getWorldPosition(this._v);
      const pos = this._v.clone();
      mesh.getWorldQuaternion(this._q);
      return { mesh, box, pos, quat: this._q.clone() };
    });

    // ---- ② union-find：AABB 互相接触（留 CLUSTER_MARGIN 容差）→ 同簇 ----
    const uf = items.map((_, i) => i);          // union-find（别和参数 parent 重名）
    const find = (i: number): number => {
      while (uf[i] !== i) {
        uf[i] = uf[uf[i]];
        i = uf[i];
      }
      return i;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) uf[rb] = ra;
    };
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i].box;
        const b = items[j].box;
        if (
          a.min.x - CLUSTER_MARGIN < b.max.x && a.max.x + CLUSTER_MARGIN > b.min.x
          && a.min.y - CLUSTER_MARGIN < b.max.y && a.max.y + CLUSTER_MARGIN > b.min.y
          && a.min.z - CLUSTER_MARGIN < b.max.z && a.max.z + CLUSTER_MARGIN > b.min.z
        ) {
          union(i, j);
        }
      }
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < items.length; i++) {
      const r = find(i);
      const list = groups.get(r);
      if (list) list.push(i);
      else groups.set(r, [i]);
    }

    // ---- ③ 每簇：算并集中心/半长 → 建 Group（成员烘焙进 Group 局部坐标）→ 建刚体 ----
    for (const idxs of groups.values()) {
      const unionBox = new THREE.Box3();
      for (const i of idxs) unionBox.union(items[i].box);
      const center = unionBox.getCenter(new THREE.Vector3());
      const half = unionBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);

      const group = new THREE.Group();
      group.position.copy(center);
      parent.add(group);
      const parts: Cluster['parts'] = [];
      for (const i of idxs) {
        const it = items[i];
        // 成员原样搬进 Group：位置/姿态换算到 Group 局部（Group 初始无旋转）
        it.mesh.parent?.remove(it.mesh);
        it.mesh.position.copy(it.pos).sub(center);
        it.mesh.quaternion.copy(it.quat);
        group.add(it.mesh);
        const c = it.box.getCenter(new THREE.Vector3()).sub(center);
        const s = it.box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        parts.push({ hx: s.x, hy: s.y, hz: s.z, cx: c.x, cy: c.y, cz: c.z });
      }
      // 刚体：主碰撞体取并集盒，其余部件作为附加碰撞体（避免大空盒互相打架）
      const first = parts[0];
      // 主碰撞体 = 部件 0（带偏移），其余部件作为附加碰撞体 —— 全部相对簇中心。
      // 这样"一簇家具"是真正的复合刚体：推动时整体平移/旋转，部件之间不会互相挤开。
      const id = this.world.addDynamic(
        { x: center.x, y: center.y, z: center.z },
        {
          shape: { type: 'cuboid', hx: first.hx, hy: first.hy, hz: first.hz },
          shapeOffset: { x: first.cx, y: first.cy, z: first.cz },
          extraColliders: parts.slice(1).map((p) => ({
            shape: { type: 'cuboid', hx: p.hx, hy: p.hy, hz: p.hz },
            offset: { x: p.cx, y: p.cy, z: p.cz },
          })),
          density: FURNITURE_DENSITY,
          linearDamping: FURNITURE_DAMPING,
          canSleep: true,
        },
      );
      this.clusters.push({
        id,
        group,
        parts,
        half,
        center: center.clone(),
        box: unionBox.clone(),
      });

      // ---- ★ 视觉跟随件：初始位置落在本簇并集盒内的（接触阴影等）→ 挂进 Group ----
      for (let k = followers.length - 1; k >= 0; k--) {
        const f = followers[k];
        f.updateWorldMatrix(true, false);
        f.getWorldPosition(this._v);
        const fx = this._v.x;
        const fz = this._v.z;
        const fy = this._v.y;
        if (fx < unionBox.min.x || fx > unionBox.max.x || fz < unionBox.min.z || fz > unionBox.max.z) continue;
        if (fy > unionBox.max.y + 0.2 || fy < unionBox.min.y) continue;
        followers.splice(k, 1);
        f.parent?.remove(f);
        f.position.set(fx - center.x, fy - center.y, fz - center.z);
        group.add(f);
      }
    }
  }

  /** ★ 静态围栏：地面 + 四面墙（家具不会被推出房间） */
  addRoomBounds(halfW: number, halfD: number): void {
    this.world.addFixed({ x: 0, y: -0.5, z: 0 }, { type: 'cuboid', hx: halfW + 6, hy: 0.5, hz: halfD + 6 });
    const t = 0.6;
    const h = 6;
    this.world.addFixed({ x: 0, y: h / 2, z: -halfD - t / 2 }, { type: 'cuboid', hx: halfW + 6, hy: h / 2, hz: t / 2 });
    this.world.addFixed({ x: 0, y: h / 2, z: halfD + t / 2 }, { type: 'cuboid', hx: halfW + 6, hy: h / 2, hz: t / 2 });
    this.world.addFixed({ x: -halfW - t / 2, y: h / 2, z: 0 }, { type: 'cuboid', hx: t / 2, hy: h / 2, hz: halfD + 6 });
    this.world.addFixed({ x: halfW + t / 2, y: h / 2, z: 0 }, { type: 'cuboid', hx: t / 2, hy: h / 2, hz: halfD + 6 });
  }

  /** ★ 运动学道具（小车 / 行车吊箱）：位置由动画给，rapier 负责推挤沿路家具 */
  addKinetic(mover: KineticMover): void {
    const p = mover.at(0);
    const id = this.world.addKinematic({ x: p.x, y: p.y, z: p.z }, {
      type: 'cuboid', hx: mover.hx, hy: mover.hy, hz: mover.hz,
    });
    this.kinetic.push({ id, mover });
  }

  /** ★ 角色推挤：与圆相交的簇"给速度"（无扭矩 → 家具平移不翻倒）。
   *  只加速不减速：家具已经在沿同方向更快移动时不干预（避免把飞出去的货箱拽住）。 */
  pushAt(x: number, z: number, r: number, dirX: number, dirZ: number): void {
    for (const c of this.clusters) {
      const cx = Math.max(c.center.x - c.half.x, Math.min(x, c.center.x + c.half.x));
      const cz = Math.max(c.center.z - c.half.z, Math.min(z, c.center.z + c.half.z));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz > r * r) continue;
      this.world.wake(c.id);
      const v = this.world.getLinearVelocity(c.id);
      const along = v.x * dirX + v.z * dirZ;      // 当前沿推动方向的速度分量
      if (along >= PUSH_SPEED) continue;          // 已经在跑 → 别压速度
      // v_new = d·PUSH_SPEED + (v − (v·d)d)：沿推动方向补到目标速度，横向分量原样保留
      this.world.setLinearVelocity(
        c.id,
        v.x + (PUSH_SPEED - along) * dirX,
        0,
        v.z + (PUSH_SPEED - along) * dirZ,
      );
    }
  }

  /** 每帧：步进 + 同步 Group + 把每簇的世界 AABB 刷进 solids（挡路判定跟着家具走） */
  step(dt: number, t: number, solids: SolidBox[]): void {
    // 运动学道具先写位置（rapier 在 step 里处理推挤）
    for (const k of this.kinetic) {
      const p = k.mover.at(t);
      this.world.setKinematicPosition(k.id, p.x, p.y, p.z);
    }
    // 固定步长累加（最多补 3 步，防卡顿后爆炸）
    this.acc = Math.min(this.acc + dt, this.stepDt * 3);
    while (this.acc >= this.stepDt) {
      this.world.step();
      this.acc -= this.stepDt;
    }
    // 同步 mesh + AABB
    solids.length = 0;
    for (const c of this.clusters) {
      const p = this.world.getPosition(c.id);
      const q = this.world.getRotation(c.id);
      c.group.position.set(p.x, p.y, p.z);
      c.group.quaternion.set(q.x, q.y, q.z, q.w);
      // 并集盒随刚体姿态走：半长按旋转后的绝对值展开
      this._q.set(q.x, q.y, q.z, q.w);
      this._ext.copy(c.half).applyQuaternion(this._q);
      this._ext.set(Math.abs(this._ext.x), Math.abs(this._ext.y), Math.abs(this._ext.z));
      // 中心也随刚体移动（原中心 → 刚体中心）
      solids.push({
        minX: p.x - this._ext.x,
        maxX: p.x + this._ext.x,
        minZ: p.z - this._ext.z,
        maxZ: p.z + this._ext.z,
      });
      // 记录当前中心（pushAt 用）
      c.center.set(p.x, p.y, p.z);
    }
  }

  /** 释放（刚体 + Group 归还场景） */
  dispose(): void {
    for (const c of this.clusters) {
      this.world.removeBody(c.id);
      c.group.parent?.remove(c.group);
    }
    this.clusters.length = 0;
    for (const k of this.kinetic) this.world.removeBody(k.id);
    this.kinetic.length = 0;
    this._box.makeEmpty();
  }
}
