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

export class SwarmTrace {
  private readonly units = new Map<number, UnitRec>();
  private readonly squads = new Map<number, SquadSample[]>();
  private readonly globals: GlobalSample[] = [];
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
    for (const s of swarm.squads.all()) {
      const st = swarm.tactics.board.get(s.id);
      const o = st?.order;
      let arr = this.squads.get(s.id);
      if (!arr) { arr = []; this.squads.set(s.id, arr); }
      arr.push({
        t: Math.round(this.t), kind: o?.kind ?? '-', mission: o?.mission ?? '-',
        tx: Math.round(o?.target?.x ?? 0), tz: Math.round(o?.target?.z ?? 0), src: st?.source ?? '-',
      });
      if (arr.length > CAP_S) arr.shift();
    }
    const c = swarm.commander as unknown as {
      stage?: string; battlePosture?: string; postureP?: number;
      builtSlots?: { size: number }; buildPieces?: unknown[]; digPasses?: { size: number };
      holeTable?: { holes: readonly { cells: number; maxDepth: number }[]; covers: readonly unknown[] };
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
    return { generatedAt: new Date().toISOString(), durS: Math.round(this.t), units, squads, globals: this.globals };
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