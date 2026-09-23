// ============================================================
// EnemyListPanel —— 右侧敌人列表（RTS 侧 UI，外接解耦）
//   层级：兵种（Squad.mobKind → 名册名） → 队长（leaderUid） → 队内代理
//   交互：点组头展开/收起；点队长/代理 = 选中（红圈由 EnemyManager 负责）
//   数据：只读 swarm.squads.all() / enemyMgr（不动敌人基类）
// ============================================================
import type { SwarmSystem } from '../systems/swarm/SwarmSystem';
import type { EnemyManager, EnemyHandle } from './EnemyManager';

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

  constructor(
    private readonly swarm: SwarmSystem,
    private readonly enemyMgr: EnemyManager,
    private readonly names: readonly string[],
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

  /** 2Hz 重建（保留展开状态 + 选中高亮） */
  refresh(): void {
    const now = performance.now();
    if (now - this.lastBuild < 500) return;
    this.lastBuild = now;
    const selected = new Set(this.enemyMgr.selected().map((h: EnemyHandle) => h.uid));
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
        const sRow = document.createElement('div');
        sRow.textContent = `${sopen ? '▾' : '▸'} 队长 #${sq.leader} · 队${sq.id} · ${sq.members.length}人 · ${ratio}%`;
        sRow.style.cssText = `padding:3px 6px 3px 18px;cursor:pointer;border-radius:4px;color:${selected.has(sq.leader) ? '#ffd24a' : '#cfe3f5'};`;
        sRow.onmouseenter = () => { sRow.style.background = 'rgba(110,170,235,0.12)'; };
        sRow.onmouseleave = () => { sRow.style.background = 'transparent'; };
        sRow.onclick = (e) => {
          sopen ? this.expandedSquads.delete(sq.id) : this.expandedSquads.add(sq.id);
          this.pick(sq.leader, e);
          this.lastBuild = 0;
        };
        frag.appendChild(sRow);
        if (!sopen) continue;
        for (const uid of sq.members) {
          const h = this.enemyMgr.find(uid);
          if (!h) continue;
          const mRow = document.createElement('div');
          const hpPct = h.maxHp > 0 ? Math.round((h.hp / h.maxHp) * 100) : 100;
          mRow.textContent = `${uid === sq.leader ? '★' : '·'} ${h.tier} #${uid} · ${hpPct}%`;
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
