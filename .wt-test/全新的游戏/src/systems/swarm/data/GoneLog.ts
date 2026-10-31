// ============================================================
// data/GoneLog —— 销毁前快照（用户建议 2026-09-27）
// ============================================================
// 单位被回收/阵亡前，记录"当时它为什么可能发呆"：自己的位置/队长位置/距离、
// 自己的成员路线状态（无队长/无路线/空路线）、当前指令目标、载体/分层、原因。
// 环形 64 条；探针 dump() 读——**纯诊断，不参与任何逻辑**。
// ============================================================

export interface GoneRec {
  at: number;
  uid: number;
  carrier: 'pool' | 'entity';
  killed: boolean;
  reason?: string;
  x: number;
  z: number;
  squadId: number;
  leaderUid: number;
  leaderX: number;
  leaderZ: number;
  /** 与队长距离（-1 = 无队长） */
  distLead: number;
  /** 成员路线点数：-2 无队长 / -1 无路线缓存 / 0 空路线（寻路失败） / >0 有路线 */
  route: number;
  orderX: number;
  orderZ: number;
  dirKind: number;
  dirX: number;
  dirZ: number;
  tier: number;
}

const CAP = 64;
const ring: GoneRec[] = [];

export const goneLog = {
  push(r: GoneRec): void {
    if (ring.length >= CAP) ring.shift();
    ring.push(r);
  },
  dump(n = 20): GoneRec[] {
    return ring.slice(Math.max(0, ring.length - n));
  },
  clear(): void {
    ring.length = 0;
  },
  get size(): number {
    return ring.length;
  },
};
