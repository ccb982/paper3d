// ============================================================
// EnemyManager —— RTS 侧"全体敌人管理器"（**外接**，不改敌人基类）
//   · 统一查询：L3 实体（enemies 活数组）+ L2 池代理（swarm.pool 数组）→ EnemyHandle
//   · 选择：单击拾取 / 框选 / Shift 加选 / Esc 清空
//   · 表现：选中敌人脚下**红圈**（池化 Mesh，每帧跟随）
//   · 解耦：只读 EnemyBase 公共字段（position/hp/maxHp/dead/swarmUid）与池数组
// ============================================================
import * as THREE from 'three';
import type { EnemyBase } from '../entity/EnemyBase';
import type { SwarmSystem } from '../systems/swarm/SwarmSystem';

export interface EnemyHandle {
  uid: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  tier: 'L3' | 'L2';
  entity?: EnemyBase;
}

const _v = new THREE.Vector3();

export class EnemyManager {
  private readonly enemies: EnemyBase[];
  private readonly swarm: SwarmSystem;
  private readonly camera: THREE.Camera;
  private readonly ringGroup = new THREE.Group();
  private readonly rings: THREE.Mesh[] = [];
  private sel: EnemyHandle[] = [];
  /** 选择变化回调（HUD/命令面板用） */
  onChanged: (() => void) | null = null;

  constructor(opts: { enemies: EnemyBase[]; swarm: SwarmSystem; camera: THREE.Camera; scene: THREE.Scene }) {
    this.enemies = opts.enemies;
    this.swarm = opts.swarm;
    this.camera = opts.camera;
    this.ringGroup.renderOrder = 22;
    opts.scene.add(this.ringGroup);
  }

  /** 全体敌人（L3 实体 + L2 代理）——统一句柄 */
  list(): EnemyHandle[] {
    const out: EnemyHandle[] = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      out.push({ uid: e.swarmUid, x: e.position.x, y: e.position.y, z: e.position.z, hp: e.hp, maxHp: e.maxHp, tier: 'L3', entity: e });
    }
    const p = this.swarm.pool;
    for (let i = 0; i < p.count; i++) {
      if (p.hp[i] <= 0) continue;
      out.push({ uid: p.swarmUid[i], x: p.x[i], y: p.y[i], z: p.z[i], hp: p.hp[i], maxHp: p.maxHp[i], tier: 'L2' });
    }
    return out;
  }

  private toScreen(h: EnemyHandle): { x: number; y: number; z: number } {
    const v = _v.set(h.x, h.y + 1.0, h.z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, z: v.z };
  }

  /** 单击拾取（屏幕像素；radius = 命中容差） */
  pickAt(sx: number, sy: number, radius = 26): EnemyHandle | null {
    let best: EnemyHandle | null = null;
    let bd = radius * radius;
    for (const h of this.list()) {
      const s = this.toScreen(h);
      if (s.z > 1) continue;
      const d = (s.x - sx) ** 2 + (s.y - sy) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  /** 框选（屏幕像素矩形） */
  pickBox(x0: number, y0: number, x1: number, y1: number): EnemyHandle[] {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1);
    const ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    const out: EnemyHandle[] = [];
    for (const h of this.list()) {
      const s = this.toScreen(h);
      if (s.z > 1) continue;
      if (s.x >= lx && s.x <= hx && s.y >= ly && s.y <= hy) out.push(h);
    }
    return out;
  }

  select(handles: EnemyHandle[] | null, additive = false): void {
    if (!additive) this.sel = [];
    if (handles) {
      for (const h of handles) {
        if (!this.sel.some((s) => s.uid === h.uid && s.tier === h.tier)) this.sel.push(h);
      }
    }
    this.onChanged?.();
    this.syncRings();
  }

  clear(): void { this.select(null, false); }
  selected(): EnemyHandle[] { return this.sel; }

  /** 每帧：红圈跟随（敌人移动/死亡自动收敛） */
  update(): void {
    const alive = new Set<string>();
    for (const h of this.list()) alive.add(`${h.tier}:${h.uid}`);
    const before = this.sel.length;
    this.sel = this.sel.filter((h) => alive.has(`${h.tier}:${h.uid}`));
    if (this.sel.length !== before) this.onChanged?.();
    this.syncRings();
  }

  private syncRings(): void {
    while (this.rings.length < this.sel.length) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.15, 24),
        new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 22;
      this.rings.push(m);
      this.ringGroup.add(m);
    }
    for (let i = 0; i < this.rings.length; i++) {
      const m = this.rings[i];
      const h = this.sel[i];
      if (!h) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(h.x, h.y + 0.08, h.z);
    }
  }

  dispose(): void {
    for (const m of this.rings) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.ringGroup.remove(m);
    }
    this.rings.length = 0;
    this.sel = [];
  }
}
