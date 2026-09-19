// ============================================================
// SwarmDebugOverlay —— 敌人小队/属性/指令可视化（?swarmdbg=1）
// ============================================================
// 屏幕空间 2D 覆盖层（DOM canvas；pointer-events:none）：
//   · 小队：质心标签（#id 属性 · 队长uid · 命令）+ 队长→成员连线
//   · 属性：按小队属性着色（防御/突击/远程/后勤/飞行/混编）
//   · 指令：成员当前个体指令文字 + 指令目标方向短线
//   · 顶部信息板：最近代理/实体决策状态（为什么打/不打）
// 数据由 WorldMode 低频（10Hz）喂入；无 flag 时完全不创建（零开销）。
// ============================================================

import * as THREE from 'three';
import { DIRECTIVE_CODES, directiveCode } from '../../entity/SwarmUnit';
import type { EnemyBase } from '../../entity/EnemyBase';
import type { SwarmSystem } from '../../systems/swarm/SwarmSystem';

export interface SwarmDbgUnit {
  x: number; y: number; z: number;
  squadId: number;
  leader: boolean;
  entity: boolean;
  /** DIRECTIVE_CODES 下标（0 = none） */
  directive: number;
  targetX: number;
  targetZ: number;
}

export interface SwarmDbgSquad {
  id: number;
  type: string;
  /** 兵种名（一队一兵种） */
  mobName: string;
  leaderUid: number;
  order: string;
  cx: number; cy: number; cz: number;
  alive: number;
}

const TYPE_COLOR: Record<string, string> = {
  defense: '#4aa3ff',
  assault: '#ff7a45',
  ranged: '#ffd75e',
  logistics: '#7dffa0',
  flyer: '#c792ea',
  mixed: '#bbbbbb',
};

const _v = new THREE.Vector3();

/** 采集上下文（WorldMode 只接线，不持有采集逻辑） */
export interface SwarmDbgHost {
  swarm: SwarmSystem;
  enemies: EnemyBase[];
  /** mobIndex → 显示名（小队标签用） */
  mobName?: (kind: number) => string;
  playerX: number;
  playerY: number;
  playerZ: number;
  camera: THREE.Camera;
  groundAt: (x: number, z: number) => number;
}

/** 每帧（内部 10Hz 限流）：采集小队/属性/指令 + 最近丹位决策状态 → 绘制 */
export function updateSwarmDebug(dbg: SwarmDebugOverlay, host: SwarmDbgHost): void {
  const { swarm, enemies } = host;
  const pool = swarm.pool;
  const units = dbg.unitsBuf;
  units.length = 0;
  for (let i = 0; i < pool.count; i++) {
    units.push({
      x: pool.x[i], y: pool.y[i], z: pool.z[i],
      squadId: pool.squadId[i], leader: pool.isLeader[i] === 1, entity: false,
      directive: pool.directiveKind[i],
      targetX: pool.directiveTargetX[i], targetZ: pool.directiveTargetZ[i],
    });
  }
  for (const e of enemies) {
    units.push({
      x: e.position.x, y: e.position.y, z: e.position.z,
      squadId: e.squadId, leader: e.isLeader, entity: true,
      directive: directiveCode(e.directiveKind),
      targetX: e.directiveTargetX, targetZ: e.directiveTargetZ,
    });
  }
  const squads = dbg.squadsBuf;
  squads.length = 0;
  for (const s of swarm.squads.all()) {
    const order = swarm.tactics.board.get(s.id);
    let cx = 0, cz = 0, n = 0;
    for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
    if (n > 0) { cx /= n; cz /= n; }
    squads.push({
      id: s.id, type: s.type, mobName: host.mobName?.(s.mobKind) ?? '',
      leaderUid: s.leaderUid,
      order: order ? order.order.kind : '-',
      cx, cy: host.groundAt(cx, cz), cz, alive: s.members.size,
    });
  }
  // 信息板：最近代理 + 最近实体（决策链一览：为什么打/不打）
  const info = dbg.infoBuf;
  info.length = 0;
  let bestA = -1, bestAD = Infinity;
  for (let i = 0; i < pool.count; i++) {
    const d2 = (pool.x[i] - host.playerX) ** 2 + (pool.z[i] - host.playerZ) ** 2;
    if (d2 < bestAD) { bestAD = d2; bestA = i; }
  }
  if (bestA >= 0) {
    const i = bestA;
    info.push(`代理 d=${Math.sqrt(bestAD).toFixed(1)}m tier=${pool.tier[i]} aggro=${pool.aggro[i].toFixed(1)} intent=${pool.intent[i]} 开火=${pool.atomFire[i]} cd=${pool.attackCd[i].toFixed(2)} 指令=${DIRECTIVE_CODES[pool.directiveKind[i]]}`);
  }
  let bestE: EnemyBase | null = null, bestED = Infinity;
  for (const e of enemies) {
    const d2 = (e.position.x - host.playerX) ** 2 + (e.position.z - host.playerZ) ** 2;
    if (d2 < bestED) { bestED = d2; bestE = e; }
  }
  if (bestE) {
    info.push(`实体 d=${Math.sqrt(bestED).toFixed(1)}m AI=${bestE.aiStateMachine?.currentState ?? '-'} 禁火=${bestE.fireHold} 指令=${bestE.directiveKind} 命令=${bestE.orderKind}`);
  }
  dbg.update(host.camera, units, squads, info);

  // ---- 可复制面板文本：小队（属性/队长/命令）+ 指令聚合 ----
  const dirCount = new Map<number, Map<string, number>>();
  for (const u of units) {
    let m = dirCount.get(u.squadId);
    if (!m) { m = new Map(); dirCount.set(u.squadId, m); }
    const name = DIRECTIVE_CODES[u.directive] ?? '?';
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  const lines: string[] = [];
  lines.push(`[蜂群指令面板] 代理=${pool.count} 实体=${enemies.length} 小队=${squads.length}`);
  for (const t of info) lines.push(t);
  for (const s of squads) {
    const m = dirCount.get(s.id);
    const dirs = m ? [...m.entries()].map(([k, v]) => `${k}×${v}`).join(' ') : 'none';
    lines.push(`#${s.id} ${s.mobName}·${s.type} L${s.leaderUid} · ${s.order} (${s.alive}) | 指令: ${dirs}`);
  }
  dbg.setText(lines.join('\n'));
}

export class SwarmDebugOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** 复用缓冲（零每帧分配） */
  readonly unitsBuf: SwarmDbgUnit[] = [];
  readonly squadsBuf: SwarmDbgSquad[] = [];
  readonly infoBuf: string[] = [];
  /** 可复制指令面板（DOM；可选中/复制） */
  private panel: HTMLDivElement;
  private pre: HTMLPreElement;
  private text = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:fixed;inset:0;z-index:997;pointer-events:none;';
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    // 指令面板（右侧；可选中可复制）
    this.panel = document.createElement('div');
    this.panel.style.cssText =
      'position:fixed;right:8px;top:8px;width:430px;max-height:62vh;z-index:998;' +
      'background:rgba(0,0,0,0.72);color:#cfefff;font:11px/1.45 monospace;' +
      'border:1px solid #3a5a6a;border-radius:4px;padding:6px;overflow:auto;' +
      'user-select:text;pointer-events:auto;';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;';
    const title = document.createElement('div');
    title.textContent = '指令面板（可复制）';
    title.style.cssText = 'flex:1;color:#9fe8ff;font-weight:bold;';
    const btn = document.createElement('button');
    btn.textContent = '复制';
    btn.style.cssText =
      'font:11px monospace;padding:1px 8px;cursor:pointer;background:#173040;' +
      'color:#9fe8ff;border:1px solid #3a5a6a;border-radius:3px;';
    btn.onclick = () => {
      const t = this.text;
      const done = (ok: boolean): void => {
        btn.textContent = ok ? '已复制' : '复制失败';
        setTimeout(() => { btn.textContent = '复制'; }, 1200);
      };
      navigator.clipboard?.writeText(t).then(() => done(true)).catch(() => done(false));
    };
    bar.appendChild(title);
    bar.appendChild(btn);
    this.pre = document.createElement('pre');
    this.pre.style.cssText = 'margin:0;white-space:pre-wrap;word-break:break-all;';
    this.panel.appendChild(bar);
    this.panel.appendChild(this.pre);
    document.body.appendChild(this.panel);
  }

  dispose(): void {
    this.canvas.remove();
    this.panel.remove();
  }

  /** 面板文本（供复制） */
  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.pre.textContent = text;
  }

  /** 低频绘制：投影世界坐标 → 屏幕（相机为世界相机） */
  update(camera: THREE.Camera, units: SwarmDbgUnit[], squads: SwarmDbgSquad[], info: string[]): void {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const typeOf = new Map<number, string>();
    for (const s of squads) typeOf.set(s.id, s.type);
    const bySquad = new Map<number, SwarmDbgUnit[]>();
    for (const u of units) {
      let arr = bySquad.get(u.squadId);
      if (!arr) { arr = []; bySquad.set(u.squadId, arr); }
      arr.push(u);
    }

    // ---- 小队：队长→成员连线 + 质心标签（属性着色） ----
    ctx.font = '11px monospace';
    for (const s of squads) {
      const color = TYPE_COLOR[s.type] ?? '#bbb';
      const members = bySquad.get(s.id) ?? [];
      const leader = members.find((m) => m.leader);
      if (leader) {
        const lp = this.project(camera, leader.x, leader.y, leader.z);
        if (lp) {
          ctx.strokeStyle = color + '55';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (const m of members) {
            if (m === leader) continue;
            const mp = this.project(camera, m.x, m.y, m.z);
            if (!mp) continue;
            ctx.moveTo(lp.x, lp.y);
            ctx.lineTo(mp.x, mp.y);
          }
          ctx.stroke();
        }
      }
      const cp = this.project(camera, s.cx, s.cy + 1.6, s.cz);
      if (cp) {
        const label = `#${s.id} ${s.mobName}·${s.type} L${s.leaderUid} · ${s.order} (${s.alive})`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(cp.x - tw / 2 - 3, cp.y - 20, tw + 6, 14);
        ctx.fillStyle = color;
        ctx.fillText(label, cp.x - tw / 2, cp.y - 9);
      }
    }

    // ---- 单位：点（实体=方块/代理=圆）+ 指令文字 + 目标短线 ----
    ctx.font = '10px monospace';
    for (const u of units) {
      const p = this.project(camera, u.x, u.y, u.z);
      if (!p) continue;
      const color = TYPE_COLOR[typeOf.get(u.squadId) ?? 'mixed'] ?? '#bbb';
      ctx.fillStyle = u.entity ? color : color + 'aa';
      ctx.beginPath();
      if (u.entity) ctx.rect(p.x - 3, p.y - 3, 6, 6);
      else ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (u.leader) {
        // ★ 队长：白底圆 + L（与普通成员区分）
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111111';
        ctx.font = '9px monospace';
        ctx.fillText('L', p.x - 2.5, p.y + 3);
        ctx.font = '10px monospace';
      }
      if (u.directive !== 0) {
        const name = DIRECTIVE_CODES[u.directive] ?? '?';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(name, p.x + 7, p.y + 3);
        const tp = this.project(camera, u.targetX, 0, u.targetZ);
        if (tp && (u.targetX !== 0 || u.targetZ !== 0)) {
          ctx.strokeStyle = '#ffffff66';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(tp.x, tp.y);
          ctx.stroke();
        }
      }
    }

    // ---- 顶部信息板：最近代理/实体状态（为什么打/不打） ----
    if (info.length > 0) {
      ctx.font = '12px monospace';
      const lh = 16;
      let bw = 0;
      for (const t of info) bw = Math.max(bw, ctx.measureText(t).width);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(8, 8, bw + 16, info.length * lh + 10);
      ctx.fillStyle = '#9fe8ff';
      info.forEach((t, i) => ctx.fillText(t, 16, 8 + 18 + i * lh));
    }
  }

  private project(camera: THREE.Camera, x: number, y: number, z: number): { x: number; y: number } | null {
    _v.set(x, y + 0.8, z).project(camera);
    if (_v.z > 1) return null;
    return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight };
  }
}
