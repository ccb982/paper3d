// ============================================================
// AiTrace —— 给 AI 读的行为/命令记录器（RTS 侧调试设施，外接只读）
//   事件流：命令（引擎/队长/玩家）/ 个体指令（队长→成员）/ 寻路结果 / 单位快照 / 生死
//   输出：dump()=JSONL 全量 · digest(n)=中文摘要（可直接贴给 AI）· download()=文件
//   原则：只读（squads/board/cmdLog/pool/enemies/eventBus），不干扰引擎
// ============================================================
import { eventBus } from '../core/EventBus';
import type { SwarmSystem } from '../systems/swarm/SwarmSystem';
import type { EnemyBase } from '../entity/EnemyBase';
import type { OrderBus, SquadOrder } from '../order/OrderBus';
import type { SquadView, SquadViewPort } from '../systems/swarm/engine/SquadView';
import { orderCn, directiveCn, sourceCn } from '../ui/cn';
import { orderFromCode, directiveFromCode } from '../entity/SwarmUnit';

interface TraceEvent {
  t: number;                 // 秒（performance.now/1000）
  ev: 'boot' | 'order' | 'directive' | 'path' | 'unit' | 'kill' | 'gone' | 'player';
  squad?: number;
  uid?: number;
  tier?: 'L2' | 'L3';
  source?: string;
  kind?: string;
  tx?: number;
  tz?: number;
  mission?: string;
  seq?: number;
  reach?: boolean;           // 命令目标有向可达（发令时核验）
  from?: [number, number];
  goal?: [number, number];
  pts?: number;
  stepK?: number;
  stepN?: number;
  hp?: number;
  maxHp?: number;
  x?: number;
  z?: number;
  mob?: number;
}

export class AiTrace {
  private readonly ring: TraceEvent[] = [];
  private readonly cap = 12000;
  private accum = 0;
  private readonly lastSquad = new Map<number, string>();
  private readonly lastPath = new Map<number, string>();
  private readonly lastDir = new Map<number, string>();
  private unsubs: (() => void)[] = [];

  constructor(
    private readonly swarm: SwarmSystem,
    private readonly enemies: EnemyBase[],
    private readonly seed: number,
    private readonly names: readonly string[],
    orderBus?: OrderBus,
    /** ★ 引擎只读视图（替代旧镜像板） */
    private readonly view?: SquadViewPort,
  ) {
    this.push({ t: this.now(), ev: 'boot', mission: `seed=${seed} 兵种=${names.join('/')}` });
    this.unsubs.push(eventBus.on('enemy_killed', (p: { uid: number; x: number; z: number }) => {
      this.push({ t: this.now(), ev: 'kill', uid: p.uid, x: +p.x.toFixed(1), z: +p.z.toFixed(1) });
    }));
    this.unsubs.push(eventBus.on('enemy_removed', (p: { uid: number; reason?: string }) => {
      this.push({ t: this.now(), ev: 'gone', uid: p.uid, mission: p.reason });
    }));
    if (orderBus) orderBus.onIssue = (o: SquadOrder) => {
      this.push({
        t: this.now(), ev: 'player', source: 'player', kind: o.kind,
        tx: +o.target.x.toFixed(1), tz: +o.target.z.toFixed(1), seq: o.seq, mission: o.mission,
      });
    };
  }

  private now(): number { return +(performance.now() / 1000).toFixed(2); }

  private push(e: TraceEvent): void {
    this.ring.push(e);
    if (this.ring.length > this.cap) this.ring.splice(0, this.ring.length - this.cap);
  }

  /** 每帧调用；内部 2Hz 采样（命令/指令/路径只在**变化**时记录，保证可读） */
  update(dt: number): void {
    this.accum += dt;
    if (this.accum < 0.5) return;
    this.accum = 0;
    const t = this.now();
    // ---- 队级：命令 + 寻路结果 ----
    const vmap = new Map<number, SquadView>();
    if (this.view) for (const v of this.view.squads()) vmap.set(v.id, v);
    for (const s of this.swarm.squads.all()) {
      const cmd = vmap.get(s.id) ?? null;
      const o = cmd?.order;
      const sig = o ? `${o.kind}|${(o.target?.x ?? 0) | 0},${(o.target?.z ?? 0) | 0}|${o.seq}|${o.source}` : 'none';
      if (this.lastSquad.get(s.id) !== sig) {
        this.lastSquad.set(s.id, sig);
        if (o) {
          // 可达核验（发令时一次；有向 BFS）
          let reach = false;
          try {
            const navAny = (this.swarm as unknown as {
              nav?: { feas?: { find: (ax: number, az: number, bx: number, bz: number, out: { x: number; z: number }[]) => string } };
            }).nav;
            const lead = s.members.get(s.leaderUid);
            const out: { x: number; z: number }[] = [];
            reach = !!lead && !!o.target && navAny?.feas?.find(lead.x, lead.z, o.target.x, o.target.z, out) === 'ok';
          } catch { reach = false; }
          this.push({
            t, ev: 'order', squad: s.id, source: o.source, kind: o.kind,
            tx: o.target ? +o.target.x.toFixed(1) : undefined,
            tz: o.target ? +o.target.z.toFixed(1) : undefined,
            seq: o.seq, mission: (o as { mission?: string }).mission, reach,
          });
        }
        if (cmd) {
          // ★ 寻路结果独立采样（走廊/起终点/失败冷却变化才记；4m 量化防抖）
          const psig = `${cmd.pathFromX ?? -1 | 0},${cmd.pathFromZ ?? -1 | 0}|${cmd.pathGoalX ?? -1 | 0},${cmd.pathGoalZ ?? -1 | 0}|${cmd.corridor?.length ?? 0}|${cmd.pathFailedAt ? 1 : 0}`;
          if (this.lastPath.get(s.id) !== psig) {
            this.lastPath.set(s.id, psig);
            this.push({
              t, ev: 'path', squad: s.id,
              from: cmd.pathFromX !== undefined ? [+cmd.pathFromX.toFixed(1), +cmd.pathFromZ!.toFixed(1)] : undefined,
              goal: cmd.pathGoalX !== undefined ? [+cmd.pathGoalX.toFixed(1), +cmd.pathGoalZ!.toFixed(1)] : undefined,
              pts: cmd.corridor?.length ?? 0,
              mission: cmd.pathFailedAt ? '失败冷却' : 'ok',
            });
          }
        }
      }
    }
    // ---- 成员级：队长个体指令（变化时记录；L3 实体 + L2 池）----
    const pool = this.swarm.pool;
    const idxByUid = new Map<number, number>();
    for (let i = 0; i < pool.count; i++) idxByUid.set(pool.swarmUid[i], i);
    const seen = new Set<number>();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const uid = e.swarmUid;
      seen.add(uid);
      const sig = `${e.directiveKind}|${Math.round(e.directiveTargetX / 8)},${Math.round(e.directiveTargetZ / 8)}`;
      if (this.lastDir.get(uid) !== sig) {
        this.lastDir.set(uid, sig);
        this.push({
          t, ev: 'directive', uid, tier: 'L3', squad: e.squadId >= 0 ? e.squadId : undefined,
          kind: e.directiveKind, tx: +e.directiveTargetX.toFixed(1), tz: +e.directiveTargetZ.toFixed(1),
        });
      }
    }
    for (const [uid, i] of idxByUid) {
      if (seen.has(uid)) continue;
      const kind = directiveFromCode(pool.directiveKind[i] ?? 0);
      const sig = `${kind}|${Math.round(pool.directiveTargetX[i] / 8)},${Math.round(pool.directiveTargetZ[i] / 8)}`;
      if (this.lastDir.get(uid) !== sig) {
        this.lastDir.set(uid, sig);
        const sq = this.swarm.squads.squadOf(uid);
        this.push({
          t, ev: 'directive', uid, tier: 'L2', squad: sq?.id,
          kind, tx: +pool.directiveTargetX[i].toFixed(1), tz: +pool.directiveTargetZ[i].toFixed(1),
        });
      }
    }
  }

  /** JSONL 全量（可直接喂给 AI/工具） */
  dump(): string {
    return this.ring.map((e) => JSON.stringify(e)).join('\n');
  }

  /** 中文摘要（最近 n 条；给 AI 的"人话版"） */
  digest(n = 120): string {
    const lines: string[] = [
      `# RTS 行为记录（种子 ${this.seed}，共 ${this.ring.length} 条，显示最近 ${n} 条）`,
      '# 词表：命令=推进/撤退/护卫/包抄/跃迁/集火/集结/驻守；来源=引擎/队长/玩家；层级 L2=池代理 L3=实体',
    ];
    for (const e of this.ring.slice(-n)) {
      const pos = e.tx !== undefined ? `(${e.tx}, ${e.tz})` : '';
      switch (e.ev) {
        case 'boot': lines.push(`[启动] t=${e.t} ${e.mission}`); break;
        case 'order': lines.push(`[命令] t=${e.t} 第${e.squad}队 ${sourceCn(e.source ?? '')} 下达「${orderCn(e.kind)}」→${pos}${e.mission ? ` 任务:${e.mission}` : ''}${e.reach === false ? ' ⚠不可达' : e.reach ? ' 可达' : ''}`); break;
        case 'directive': lines.push(`[指令] t=${e.t} 第${e.squad ?? '?'}队 队长→#${e.uid}(${e.tier}) 「${directiveCn(e.kind)}」→${pos}`); break;
        case 'path': lines.push(`[寻路] t=${e.t} 第${e.squad}队 起始点(${e.from?.join(',') ?? '-'})→目标点(${e.goal?.join(',') ?? '-'}) 走廊${e.pts}点${e.stepN ? ` 步${e.stepK}/${e.stepN}` : ''} ${e.mission}`); break;
        case 'unit': lines.push(`[单位] t=${e.t} #${e.uid}(${e.tier}) hp=${e.hp}/${e.maxHp} 位(${e.x}, ${e.z})`); break;
        case 'kill': lines.push(`[阵亡] t=${e.t} #${e.uid} (${e.x}, ${e.z})`); break;
        case 'gone': lines.push(`[离场] t=${e.t} #${e.uid} ${e.mission ?? ''}`); break;
        case 'player': lines.push(`[玩家令] t=${e.t} 「${orderCn(e.kind)}」→${pos}`); break;
      }
    }
    return lines.join('\n');
  }

  /** 下载 JSONL（文件名带种子与时间） */
  download(): void {
    const blob = new Blob([this.dump()], { type: 'application/jsonl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rts-aitrace-${this.seed}-${Date.now()}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
