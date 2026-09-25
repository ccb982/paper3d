// ============================================================
// EnemyListPanel —— 右侧敌人列表（RTS 侧 UI，外接解耦）
//   层级：兵种（Squad.mobKind → 名册名） → 队长（leaderUid） → 队内代理
//   交互：点组头展开/收起；点队长/代理 = 选中（红圈由 EnemyManager 负责）
//   数据：只读 swarm.squads.all() / enemyMgr（不动敌人基类）
// ============================================================
import type { SwarmSystem } from '../systems/swarm/SwarmSystem';
import type { EnemyManager, EnemyHandle } from './EnemyManager';
import { orderFromCode, directiveFromCode } from '../entity/SwarmUnit';
import type { CommandEntry, SquadViewPort } from '../systems/swarm/engine/SquadView';
import { orderCn, directiveCn, sourceCn } from './cn';

const TYPE_LABEL: Record<string, string> = {
  defense: '盾卫', assault: '突击', ranged: '远程', logistics: '后勤', mixed: '混编', flyer: '飞行',
};

export class EnemyListPanel {
  private readonly root: HTMLDivElement;
  private readonly headEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly expandedGroups = new Set<string>();
  private readonly expandedSquads = new Set<number>();
  private lastBuild = 0;
  /** ★ 点命令 → 打开命令检视地图（main 注入） */
  onInspectCommand: ((squadId: number, entry?: CommandEntry) => void) | null = null;

  constructor(
    private readonly swarm: SwarmSystem,
    private readonly enemyMgr: EnemyManager,
    private readonly names: readonly string[],
    /** ★ 引擎只读视图（替代旧镜像板） */
    private readonly view: SquadViewPort,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'right:8px', 'top:8px', 'width:264px', 'max-height:70vh', 'overflow:auto',
      'z-index:950', 'background:rgba(8,13,22,0.92)', 'border:1px solid rgba(110,170,235,0.35)',
      'border-radius:8px', 'color:#dce8f5', 'font:12px "Microsoft YaHei",sans-serif', 'user-select:none',
    ].join(';');
    this.headEl = document.createElement('div');
    this.headEl.style.cssText = 'padding:6px 10px;font-weight:bold;color:#8ac8ff;border-bottom:1px solid rgba(110,170,235,0.25);';
    this.bodyEl = document.createElement('div');
    this.bodyEl.style.cssText = 'padding:4px 6px 8px;';
    this.root.append(this.headEl, this.bodyEl);
    document.body.appendChild(this.root);
  }

  /** 点击行 → 选中（红圈） */
  private pick(uid: number, e: MouseEvent): void {
    const h = this.enemyMgr.find(uid);
    if (h) this.enemyMgr.select([h], e.shiftKey);
  }

  /** ★ 立即重建（时间轴拖动等外部事件；绕过节流） */
  refreshNow(): void {
    this.lastBuild = 0;
    this.refresh();
  }

  /** 2Hz 重建（保留展开状态 + 选中高亮） */
  refresh(): void {
    const now = performance.now();
    if (now - this.lastBuild < 500) return;
    this.lastBuild = now;
    const selected = new Set(this.enemyMgr.selected().map((h: EnemyHandle) => h.uid));
    // ★ 命令台账：每队最新令（引擎/队长来源）+ 历史（ring 尾部 3 条）
    const pool = this.swarm.pool;
    const idxByUid = new Map<number, number>();
    for (let i = 0; i < pool.count; i++) idxByUid.set(pool.swarmUid[i], i);
    const latest = new Map<number, CommandEntry>(this.view.latestCommandPerSquad(300));
    const ring = this.view.recentCommands(64);
    const historyOf = (sid: number, n = 3): CommandEntry[] => {
      const out: CommandEntry[] = [];
      for (let i = 0; i < ring.length && out.length < n; i++) if (ring[i]!.squadId === sid) out.push(ring[i]!);
      return out.reverse();
    };
    const viewOf = new Map<number, ReturnType<SquadViewPort['squads']>[number]>();
    for (const v of this.view.squads()) viewOf.set(v.id, v);
    const groups = new Map<string, { squads: { id: number; leader: number; members: number[]; hp: number; max: number }[] }>();
    for (const s of this.swarm.squads.all()) {
      const gname = this.names[s.mobKind] ?? TYPE_LABEL[s.type] ?? `#${s.mobKind}`;
      let g = groups.get(gname);
      if (!g) { g = { squads: [] }; groups.set(gname, g); }
      let hp = 0, max = 0;
      const members: number[] = [];
      for (const [uid, m] of s.members) {
        members.push(uid);
        hp += m.hp; max += m.maxHp;
      }
      members.sort((a, b) => (a === s.leaderUid ? -1 : b === s.leaderUid ? 1 : a - b));
      g.squads.push({ id: s.id, leader: s.leaderUid, members, hp, max });
    }
    let total = 0;
    for (const g of groups.values()) for (const sq of g.squads) total += sq.members.length;
    this.headEl.textContent = `敌人 ${total} · 选中 ${selected.size}`;

    const frag = document.createDocumentFragment();
    for (const [gname, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const open = this.expandedGroups.has(gname);
      const gHead = document.createElement('div');
      gHead.textContent = `${open ? '▾' : '▸'} ${gname}（${g.squads.length} 队）`;
      gHead.style.cssText = 'padding:4px 6px;cursor:pointer;color:#9fd0ff;border-radius:4px;';
      gHead.onmouseenter = () => { gHead.style.background = 'rgba(110,170,235,0.12)'; };
      gHead.onmouseleave = () => { gHead.style.background = 'transparent'; };
      gHead.onclick = () => { open ? this.expandedGroups.delete(gname) : this.expandedGroups.add(gname); this.lastBuild = 0; };
      frag.appendChild(gHead);
      if (!open) continue;
      for (const sq of g.squads) {
        const sopen = this.expandedSquads.has(sq.id);
        const ratio = sq.max > 0 ? Math.round((sq.hp / sq.max) * 100) : 100;
        const ord = viewOf.get(sq.id)?.order;
        const src = latest.get(sq.id)?.source ? sourceCn(latest.get(sq.id)!.source) : '-';
        const ordTxt = ord ? `${orderCn(ord.kind)}→(${ord.target ? `${ord.target.x | 0},${ord.target.z | 0}` : '-'})` : '无';
        const sRow = document.createElement('div');
        sRow.textContent = `${sopen ? '▾' : '▸'} 队长 #${sq.leader} · 第${sq.id}队 · ${sq.members.length}人 · ${ratio}% | 命令[${src}]：${ordTxt}`;
        sRow.style.cssText = `padding:3px 6px 3px 18px;cursor:pointer;border-radius:4px;color:${selected.has(sq.leader) ? '#ffd24a' : '#cfe3f5'};`;
        sRow.onmouseenter = () => { sRow.style.background = 'rgba(110,170,235,0.12)'; };
        sRow.onmouseleave = () => { sRow.style.background = 'transparent'; };
        sRow.onclick = (e) => {
          sopen ? this.expandedSquads.delete(sq.id) : this.expandedSquads.add(sq.id);
          // ★ 点队长行 = 选中**全队**（队长 + 队内代理，全员红圈）
          const handles: EnemyHandle[] = [];
          for (const uid of sq.members) {
            const h = this.enemyMgr.find(uid);
            if (h) handles.push(h);
          }
          this.enemyMgr.select(handles, e.shiftKey);
          this.lastBuild = 0;
        };
        // ★ [图] 按钮：打开该队当前令的检视地图（不触发选队）
        const mapBtn = document.createElement('span');
        mapBtn.textContent = ' [图]';
        mapBtn.style.cssText = 'color:#8ac8ff;';
        mapBtn.onclick = (e) => { e.stopPropagation(); this.onInspectCommand?.(sq.id, latest.get(sq.id)); };
        sRow.appendChild(mapBtn);
        frag.appendChild(sRow);
        if (!sopen) continue;
        // ★ 该队命令历史（引擎/队长来源，具体到点）
        for (const h of historyOf(sq.id)) {
          const hRow = document.createElement('div');
          const age = Math.max(0, Math.round(performance.now() / 1000 - h.at));
          hRow.textContent = `  命令历史[${sourceCn(h.source)}] ${orderCn(h.kind)}→(${h.tx | 0}, ${h.tz | 0})${h.mission ? ` ${h.mission}` : ''} （${age}秒前）`;
          hRow.style.cssText = 'padding:1px 6px 1px 26px;color:#7f95ab;font-size:11px;cursor:pointer;';
          hRow.onmouseenter = () => { hRow.style.color = '#cfe3f5'; };
          hRow.onmouseleave = () => { hRow.style.color = '#7f95ab'; };
          hRow.onclick = (e) => { e.stopPropagation(); this.onInspectCommand?.(sq.id, h); };
          frag.appendChild(hRow);
        }
        for (const uid of sq.members) {
          const h = this.enemyMgr.find(uid);
          if (!h) continue;
          const mRow = document.createElement('div');
          const hpPct = h.maxHp > 0 ? Math.round((h.hp / h.maxHp) * 100) : 100;
          // ★ 队长→成员的个体指令（L3 读实体字段；L2 读池数组）
          let dirTxt = '无';
          let okTxt = '无';
          if (h.entity) {
            const d = h.entity.directiveKind;
            dirTxt = d && d !== 'none' ? `${directiveCn(d)}→(${h.entity.directiveTargetX | 0}, ${h.entity.directiveTargetZ | 0})` : '无';
            okTxt = orderCn(h.entity.orderKind);
          } else {
            const pi = idxByUid.get(uid);
            if (pi !== undefined) {
              const dk = directiveFromCode(pool.directiveKind[pi] ?? 0);
              dirTxt = dk && dk !== 'none' ? `${directiveCn(dk)}→(${pool.directiveTargetX[pi] | 0}, ${pool.directiveTargetZ[pi] | 0})` : '无';
              okTxt = orderCn(orderFromCode(pool.orderKind[pi] ?? 0));
            }
          }
          mRow.textContent = `${uid === sq.leader ? '★' : '·'} ${h.tier} #${uid} · ${hpPct}% | 队令：${okTxt} | 受令：${dirTxt}`;
          mRow.style.cssText = `padding:2px 6px 2px 34px;cursor:pointer;border-radius:4px;color:${selected.has(uid) ? '#ffd24a' : '#a9c2d8'};`;
          mRow.onmouseenter = () => { mRow.style.background = 'rgba(110,170,235,0.12)'; };
          mRow.onmouseleave = () => { mRow.style.background = 'transparent'; };
          mRow.onclick = (e) => { this.pick(uid, e); this.lastBuild = 0; };
          frag.appendChild(mRow);
        }
      }
    }
    this.bodyEl.replaceChildren(frag);
  }

  dispose(): void { this.root.remove(); }
}
