// ============================================================
// CommanderSpawn —— 大队生成 / 逐步登场队列（自 SwarmCommander 拆出，控行数）
// ============================================================
//   · 编成来源：起飞回收名单优先（兵种/数量照旧），否则标准配比（±2 随机 + 概率精英）
//   · 放置：优先地形分析产出的可站锚点（掩体位/高地/战壕线），不足回退来向楔形环
//   · instant = 一次性上整编队（总攻/落地）；否则入队列由 drain 逐只滴灌
// 生成端口（spawnMob/spawnMobIndex/spawnBuilder）真源仍在 SwarmCommander，按需现取。
// ============================================================

import type { DefensePlan } from './LandingTerrain';
import type { UnitRole } from '../../entity/SwarmUnit';

/** 生成端口（延迟现取：模式层可能中途注入/更换钩子） */
export interface SpawnPorts {
  plan: () => DefensePlan | null;
  mob: () => ((x: number, z: number, role: UnitRole, elite?: boolean, near?: boolean) => void) | null;
  mobIndex: () => ((x: number, z: number, mobIndex: number) => void) | null;
  builder: () => ((x: number, z: number) => void) | null;
  /** ★ §13.1 编制缺口（缺谁补谁；null = 达标/无数据） */
  gap?: () => { role: string; val: number } | null;
}

/** 登场间隔（秒/只） */
const SPAWN_INTERVAL = 1.5;
/** 一局大队数上限 */
const BATTALION_MAX = 4;

export class CommanderSpawn {
  private roster: { mobIndex: number; role: UnitRole; count: number }[] | null = null;
  private battalions = 0;
  private readonly queue: { x: number; z: number; role: UnitRole; elite: boolean; mobIndex: number }[] = [];
  private accum = 0;

  constructor(private readonly p: SpawnPorts) {}

  /** ★ 起飞回收：只交名单（兵种属性 + 数量）——怎么布置由本层决定 */
  setRoster(roster: { mobIndex: number; role: UnitRole; count: number }[]): void {
    this.roster = roster.length > 0 ? roster : null;
  }

  /** 换落点复位（不动回收名单——落地还要按名单回场） */
  reset(): void {
    this.queue.length = 0;
    this.accum = 0;
    this.battalions = 0;
  }

  /** 模式退出清理（含名单） */
  clear(): void {
    this.reset();
    this.roster = null;
  }

  /** ★ 落地部署：回收名单 → 按名单逐步回场；否则开局班底 + 一个大队 */
  deploy(): void {
    if (this.roster) {
      this.battalion(false);
    } else {
      this.cadre();
      this.battalion(false);
    }
  }

  /** ★ 逐步登场：队列滴灌（每 SPAWN_INTERVAL 出一只；总攻走 instant 不入队） */
  drain(dt: number): void {
    if (this.queue.length === 0) return;
    this.accum += dt;
    while (this.accum >= SPAWN_INTERVAL && this.queue.length > 0) {
      this.accum -= SPAWN_INTERVAL;
      const u = this.queue.shift()!;
      const mobIndex = this.p.mobIndex();
      if (u.mobIndex >= 0 && mobIndex) mobIndex(u.x, u.z, u.mobIndex);
      else this.p.mob()?.(u.x, u.z, u.role, u.elite);
    }
  }

  /** ★ 生成一个大队（30 怪；按角色配比 · 沿外环弧部署；后续大队更远列阵）
   *  @param instant 总攻/落地用：true = 一次性上整编队；false = **逐步登场**（队列滴灌） */
  battalion(instant = false): boolean {
    const plan = this.p.plan();
    if (!plan || this.battalions >= BATTALION_MAX) return false;
    const roster = this.roster;
    const mob = this.p.mob();
    const mobIndex = this.p.mobIndex();
    const useRoster = !!roster && !!mobIndex;
    if (!useRoster && !mob) return false;
    this.battalions++;
    const entries: { role: UnitRole; elite: boolean; mobIndex: number }[] = [];
    if (useRoster) {
      this.roster = null;
      for (const r of roster!) {
        for (let i = 0; i < r.count; i++) entries.push({ role: r.role, elite: false, mobIndex: r.mobIndex });
      }
    } else {
      // ★ 配比（基准 30）：盾 6 / 突击 10 / 远程 6 / 后勤 4 / 飞行 4；每类 ±2；精英 0~2
      const base: [UnitRole, number][] = [
        ['shield', 6], ['assault', 10], ['ranged', 6], ['logistics', 4], ['flyer', 4],
      ];
      const comp = base.map(([role, n]) => [role, Math.max(1, n + Math.round((Math.random() - 0.5) * 4))] as [UnitRole, number]);
      // ★ §13.1 缺口偏置：场上谁占比低，这一队就多出谁（相对缺口 val → 额外 +val*6 只）
      const gp = this.p.gap?.();
      if (gp && (gp.role === 'shield' || gp.role === 'assault' || gp.role === 'ranged' || gp.role === 'logistics')) {
        const idx = comp.findIndex(([r]) => r === gp.role);
        if (idx >= 0) comp[idx] = [comp[idx][0], comp[idx][1] + Math.max(1, Math.round(gp.val * 6))];
      }
      for (const [role, n] of comp) for (let i = 0; i < n; i++) entries.push({ role, elite: false, mobIndex: -1 });
      const eliteN = (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
      for (let i = 0; i < eliteN; i++) entries.push({ role: 'assault', elite: true, mobIndex: -1 });
    }
    if (entries.length === 0) return false;
    const baseA = Math.atan2(plan.approachZ, plan.approachX);
    // ★ 集结区（正面楔形：±30°、≈96m 起）——从来向远处进场，**不围圈**
    const ringR = 96 + (this.battalions - 1) * 8;
    const total = entries.length;
    // ★ 部署锚点：**优先用自身地形分析产出的可站点**（掩体位/高地/战壕线）——
    //   保证所有兵都落在可达陆地上（此前盲投 96m 环：施工队掉湖里 → 永远开不了工）；
    //   锚点不足时才退回来向楔形环。
    const anchors = this.placementAnchors(plan);
    let k = 0;
    for (const e of entries) {
      let x: number, z: number;
      if (anchors && anchors.length > 0) {
        const a = anchors[k % anchors.length];
        x = a.x + (Math.random() - 0.5) * 2;
        z = a.z + (Math.random() - 0.5) * 2;
      } else {
        const a = baseA + (-1 + (2 * k) / total) * (Math.PI / 6);
        const rr = ringR + (Math.random() - 0.5) * 10;
        x = plan.cx + Math.cos(a) * rr;
        z = plan.cz + Math.sin(a) * rr;
      }
      k++;
      if (instant) {
        if (e.mobIndex >= 0 && mobIndex) mobIndex(x, z, e.mobIndex);
        else mob?.(x, z, e.role, e.elite);
      } else {
        this.queue.push({ x, z, role: e.role, elite: e.elite, mobIndex: e.mobIndex });
      }
    }
    return true;
  }

  /** ★ 开局班底（§3.5 扎根期）：少量近战守线 + 后勤/远程开工；其余由单日节律逐步补
   *  ★ 施工兵优先走 `spawnBuilder`（名册 canBuild 兵种）——保证开局有真正的工程队 */
  private cadre(): void {
    const plan = this.p.plan();
    if (!plan) return;
    const anchors = this.placementAnchors(plan);
    const at = (k: number): { x: number; z: number } => (anchors.length > 0
      ? { x: anchors[k % anchors.length].x, z: anchors[k % anchors.length].z }
      : { x: plan.cx + plan.approachX * 40, z: plan.cz + plan.approachZ * 40 });
    const builder = this.p.builder();
    const mob = this.p.mob();
    // ① 工程队：3 只（有专门端口用专门的；否则退"杂兵兼任"名单）
    for (let k = 0; k < 3; k++) {
      const a = at(k);
      if (builder) builder(a.x + (Math.random() - 0.5) * 2, a.z + (Math.random() - 0.5) * 2);
      else mob?.(a.x + (Math.random() - 0.5) * 2, a.z + (Math.random() - 0.5) * 2, 'assault', false, true);
    }
    // ② 近战护卫 + 远程
    if (!mob) return;
    const roles: UnitRole[] = ['shield', 'shield', 'assault', 'assault', 'ranged'];
    for (let k = 0; k < roles.length; k++) {
      const a = at(k + 3);
      mob(a.x + (Math.random() - 0.5) * 2, a.z + (Math.random() - 0.5) * 2, roles[k], false, true);
    }
  }

  /** ★ 可站部署锚点（地形分析产物：掩体位 + 高地 + 战壕线；空 = 无可用点） */
  private placementAnchors(plan: DefensePlan): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const c of plan.coverSlots) out.push({ x: c.x, z: c.z });
    for (const g of plan.highGround) out.push({ x: g.x, z: g.z });
    for (const line of plan.trenchLines) for (const p of line) out.push(p);
    return out;
  }
}
