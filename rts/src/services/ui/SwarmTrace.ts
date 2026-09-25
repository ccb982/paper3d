// ============================================================
// SwarmTrace —— 敌人行动轨迹快照（?swarmtrace=1；调试用，关闭零开销）
// ============================================================
// 1Hz 采样（内存毫秒级，长时间跑不膨胀）：
//   · 每只敌人：uid → 轨迹点 [t,x,z]×N（保留最近 180s；附带 role / squad）
//   · 每支小队：命令时间线 { kind, mission, target, source }（换令/原地/回撤一眼可见）
//   · 全局：stage / 态势 p / 已建块 / 待建块 / 挖遍数 / 存活数（工程进度曲线）
// 导出（控制台）：
//   __trace.summary()   表格：每单位 采样/路程/净位移/冻结秒数（先看谁没动、谁在绕圈）
//   __trace.dump()      JSON（轨迹 + 命令线 + 全局）
//   __trace.save()      下载 swarm-trace.json
// 用法：跑一局 → 控制台 __trace.summary()；或 node 侧取 __trace.dump() 存盘分析。
// ============================================================

import type { SwarmSystem } from '../../systems/swarm/SwarmSystem';
import { RasterMap } from '../../services/map/RasterMap';
import type { SquadViewPort } from '../../systems/swarm/engine/SquadView';

/** ★ 引擎只读视图（main 注入；旧镜像板已删） */
let squadViewOf: SquadViewPort | null = null;
export function setSwarmTraceView(v: SquadViewPort | null): void {
  squadViewOf = v;
}

const SAMPLE_DT = 1;         // 采样周期（秒）
const CAP_S = 720;           // 每单位/每队保留最近 N 秒（> 一天 DAY_SECONDS=900 的一半）
const FROZEN_MOVE = 0.5;     // 单秒位移 < 此值视为"没动"（冻结判据）

interface UnitRec { role: number; squad: number; build: number; pts: number[] }
interface SquadSample { t: number; kind: string; mission: string; tx: number; tz: number; src: string }
interface GlobalSample {
  t: number; stage: string; posture: string; p: number;
  built: number; pieces: number; pass: number; alive: number; px: number; pz: number;
  /** 坑洞现场（表条目数 / 总面积 m² / 最深 m）/ 掩体条目数 */
  holes: number; holeCells: number; holeMaxD: number; covers: number;
}

/** 施工事件（每秒 diff 一次；一份地块的一次挖/一块建成 → 一条） */
export interface DigEvent { t: number; x: number; z: number; pass: number; kind: 'dig' | 'build' }
/** 地形探针：施工块中心每拍的权威深度（RasterMap.levelDepthAt） */
export interface TerrainProbe { x: number; z: number; base: number; cur: number }

export class SwarmTrace {
  private readonly units = new Map<number, UnitRec>();
  private readonly squads = new Map<number, SquadSample[]>();
  private readonly globals: GlobalSample[] = [];
  /** 挖/建事件时间线（diff 逐秒变化；回答"啥时候/在哪挖") */
  private readonly events: DigEvent[] = [];
  /** 施工块点上的地形深度探针（base=首拍，cur=每拍；证明地形真变化） */
  readonly probes: TerrainProbe[] = [];
  private probeWarm = false;
  private readonly lastDig = new Map<string, number>();
  private readonly lastBuilt = new Set<string>();
  /** 焦点观测（施工队焦点驻守是否真的锁住） */
  private readonly focusSamples: { t: number; items: { sid: number; fidx: number; cd: number; dMin: number; n: number }[] }[] = [];
  private accum = 1e9;
  private t = 0;

  sample(dt: number, swarm: SwarmSystem, px: number, pz: number): void {
    this.t += dt;
    this.accum += dt;
    if (this.accum < SAMPLE_DT) return;
    this.accum = 0;
    const pool = swarm.pool;
    for (let i = 0; i < pool.count; i++) {
      const uid = pool.swarmUid[i];
      if (uid <= 0) continue;
      let rec = this.units.get(uid);
      if (!rec) {
        rec = { role: pool.role[i], squad: swarm.squads.squadOf(uid)?.id ?? -1,
          build: pool.canBuild[i], pts: [] };
        this.units.set(uid, rec);
      }
      rec.pts.push(Math.round(this.t), Math.round(pool.x[i]), Math.round(pool.z[i]));
      if (rec.pts.length > CAP_S * 3) rec.pts.splice(0, rec.pts.length - CAP_S * 3);
    }
    const vmap = new Map<number, { kind: string; mission: string; tx: number; tz: number; src: string }>();
    if (squadViewOf) for (const v of squadViewOf.squads()) {
      vmap.set(v.id, {
        kind: v.order?.kind ?? '-', mission: v.order?.mission ?? '-',
        tx: Math.round(v.order?.target.x ?? 0), tz: Math.round(v.order?.target.z ?? 0),
        src: v.order?.source ?? '-',
      });
    }
    for (const s of swarm.squads.all()) {
      const o = vmap.get(s.id);
      let arr = this.squads.get(s.id);
      if (!arr) { arr = []; this.squads.set(s.id, arr); }
      arr.push({
        t: Math.round(this.t), kind: o?.kind ?? '-', mission: o?.mission ?? '-',
        tx: o?.tx ?? 0, tz: o?.tz ?? 0, src: o?.src ?? '-',
      });
      if (arr.length > CAP_S) arr.shift();
    }
    const c = swarm.data as unknown as {
      stage?: string; battlePosture?: string; postureP?: number;
      builtSlots?: { size: number }; buildPieces?: unknown[]; digPasses?: { size: number };
      holeTable?: { holes: readonly { cells: number; maxDepth: number }[]; covers: readonly unknown[] };
      buildFocus?: unknown; buildCds?: unknown;
    };
    const ht = c?.holeTable;
    let holeCells = 0, holeMaxD = 0;
    for (const h of ht?.holes ?? []) { holeCells += h.cells; if (h.maxDepth > holeMaxD) holeMaxD = h.maxDepth; }
    this.globals.push({
      t: Math.round(this.t), stage: c?.stage ?? '?', posture: c?.battlePosture ?? '?',
      p: +(c?.postureP ?? 0).toFixed(2), built: c?.builtSlots?.size ?? -1,
      pieces: c?.buildPieces?.length ?? -1, pass: c?.digPasses?.size ?? -1,
      alive: pool.count, px: Math.round(px), pz: Math.round(pz),
      holes: ht?.holes?.length ?? -1, holeCells, holeMaxD: +holeMaxD.toFixed(2), covers: ht?.covers?.length ?? -1,
    });
    // 〇 焦点观测（工程队每 squad）：焦点 idx、成员到焦点最近距离、队伍冷却
    const focusView = (c?.buildFocus as unknown as Map<number, number> | undefined)
      ?? new Map<number, number>();
    const cds = c?.buildCds as unknown as Map<number, number> | undefined;
    const bpAll = c?.buildPieces as unknown as readonly { x: number; z: number }[] | undefined;
    const focusPts: { sid: number; fidx: number; cd: number; dMin: number; n: number }[] = [];
    for (const s of swarm.squads.all()) {
      const sid = s.id;
      const fdx = focusView.get(sid);
      if (fdx === undefined) continue;
      const q = bpAll?.[fdx];
      if (!q) continue;
      let dMin = Infinity, n = 0;
      for (const m of s.members.values()) {
        n++;
        const d = (m.x - q.x) ** 2 + (m.z - q.z) ** 2;
        if (d < dMin) dMin = d;
      }
      focusPts.push({ sid, fidx: fdx, cd: Math.round(cds?.get(sid) ?? 0), dMin: Math.round(Math.sqrt(dMin)), n });
    }
    if (focusPts.length > 0) this.focusSamples.push({ t: Math.round(this.t), items: focusPts });
    // ① 挖/建事件 diff（key = `${x},${z}`）
    const digp = c?.digPasses as unknown as Map<string, number> | undefined;
    for (const [key, p] of digp ?? []) {
      const prev = this.lastDig.get(key) ?? 0;
      if (p > prev) {
        const [x, z] = key.split(',').map(Number);
        this.events.push({ t: Math.round(this.t), x, z, pass: p, kind: 'dig' });
        if (this.events.length > 500) this.events.shift();
      }
      this.lastDig.set(key, p);
    }
    const builtSet = c?.builtSlots as unknown as Set<string> | undefined;
    for (const key of builtSet ?? []) {
      if (!this.lastBuilt.has(key)) {
        const [x, z] = key.split(',').map(Number);
        this.events.push({ t: Math.round(this.t), x, z, pass: 0, kind: 'build' });
        if (this.events.length > 500) this.events.shift();
        this.lastBuilt.add(key);
      }
    }
    // ② 地形探针：首拍初始化（取每施工块中心 + 玩家），之后每拍刷新现值
    if (!this.probeWarm && c?.buildPieces) {
      const bp = c.buildPieces as unknown as readonly { x: number; z: number }[];
      const seen = new Set<string>();
      for (const q of bp) {
        const k = `${q.x},${q.z}`;
        if (seen.has(k)) continue;
        seen.add(k);
        this.probes.push({ x: q.x, z: q.z, base: -1, cur: 0 });
        if (this.probes.length >= 96) break;
      }
      this.probeWarm = true;
    }
    const pm = RasterMap.current;
    if (this.probes.length > 0) {
      for (const p of this.probes) {
        const v = pm ? pm.levelDepthAt(p.x, p.z) : 0;
        if (p.base < 0) p.base = v;
        p.cur = v;
      }
    }
  }

  /** 汇总表：按"冻结时长"降序（谁没动），再看路程/净位移（谁在绕圈） */
  summary(): { uid: number; role: number; squad: number; n: number; path: number; net: number; frozenS: number }[] {
    const out: { uid: number; role: number; squad: number; n: number; path: number; net: number; frozenS: number }[] = [];
    for (const [uid, rec] of this.units) {
      const n = rec.pts.length / 3;
      let path = 0;
      let lastMoveT = n > 0 ? rec.pts[0] : 0;
      for (let k = 1; k < n; k++) {
        const d = Math.hypot(rec.pts[k * 3 + 1] - rec.pts[(k - 1) * 3 + 1],
          rec.pts[k * 3 + 2] - rec.pts[(k - 1) * 3 + 2]);
        path += d;
        if (d > FROZEN_MOVE) lastMoveT = rec.pts[k * 3];
      }
      const net = n > 1 ? Math.hypot(rec.pts[(n - 1) * 3 + 1] - rec.pts[1],
        rec.pts[(n - 1) * 3 + 2] - rec.pts[2]) : 0;
      out.push({ uid, role: rec.role, squad: rec.squad, n, path: Math.round(path),
        net: Math.round(net), frozenS: n > 0 ? Math.round(this.t - lastMoveT) : 0 });
    }
    return out.sort((a, b) => b.frozenS - a.frozenS || a.path - b.path);
  }

  /** 全量快照（JSON 可序列化） */
  dump(): unknown {
    const units: Record<number, UnitRec> = {};
    for (const [uid, rec] of this.units) units[uid] = rec;
    const squads: Record<number, SquadSample[]> = {};
    for (const [id, arr] of this.squads) squads[id] = arr;
    return {
      generatedAt: new Date().toISOString(), durS: Math.round(this.t),
      units, squads, globals: this.globals, events: this.events, probes: this.probes,
      focus: this.focusSamples,
    };
  }

  /** 下载 JSON（浏览器控制台 `__trace.save()`） */
  save(name = 'swarm-trace.json'): void {
    const blob = new Blob([JSON.stringify(this.dump())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}