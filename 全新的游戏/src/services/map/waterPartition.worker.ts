// ============================================================
// waterPartition.worker —— ★ 水体并查集划分（异步）
// ============================================================
// 主线程只做「标记」（记录每个 chunk 哪些地块与水有关）+ 收集逐块水位，
// 划分（4 邻域连通 + 水位兼容 ⇒ 分组 ⇒ 并查集合并）全部在这里跑 ⇒ 主线程零阻塞。
//
// 输入：
//   chunks: { key, blocks: number[], levels: (number|undefined)[] }[]
//     · blocks  = 该 chunk 的水块（世界 4m 块 key）
//     · levels  = 与 blocks 同序的逐块水位（未知 ⇒ undefined）
// 输出：
//   bodies: { rep, blocks: number[], level }[]
//     · rep    = bodyId（组内最小块 key，稳定）
//     · blocks = 该 body 的全部块
//     · level  = 该 body 的统一水位（各块 min）
// ============================================================

/** 水位合并容差（m）：两个块水位差超过它 ⇒ 不同水体，不连 */
const LEVEL_MERGE_TOLERANCE = 0.06;

/** 世界 4m 块 key */
const bk = (bx: number, bz: number): number => (bx + 4096) * 8192 + (bz + 4096);
const keyToX = (k: number): number => Math.floor(k / 8192) - 4096;
const keyToZ = (k: number): number => (k % 8192) - 4096;

interface ChunkInput {
  key: number;
  blocks: number[];
  levels: (number | undefined)[];
}

interface BodyOut {
  rep: number;
  blocks: number[];
  level: number;
}

export function partition(chunks: ChunkInput[]): BodyOut[] {
  // ⓪ 块 → 水位
  const levelOf = new Map<number, number>();
  for (const c of chunks) {
    for (let i = 0; i < c.blocks.length; i++) {
      const lv = c.levels[i];
      if (lv !== undefined) levelOf.set(c.blocks[i], lv);
    }
  }
  const compatible = (a: number, b: number): boolean => {
    const la = levelOf.get(a), lb = levelOf.get(b);
    if (la === undefined || lb === undefined) return true;   // 水位未知 ⇒ 先连
    return Math.abs(la - lb) <= LEVEL_MERGE_TOLERANCE;
  };

  // ① 每 chunk 内分组（4 邻域 + 水位兼容）⇒ 组 = 并查集节点
  interface Group { rep: number; blocks: number[]; chunk: number; }
  const groups: Group[] = [];
  const blockToGroup = new Map<number, number>();   // 块 → 组下标
  for (const c of chunks) {
    const set = new Set(c.blocks);
    const seen = new Set<number>();
    for (const start of c.blocks) {
      if (seen.has(start)) continue;
      const comp: number[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const cur = stack.pop()!;
        comp.push(cur);
        const bx = keyToX(cur), bz = keyToZ(cur);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nk = bk(bx + dx, bz + dz);
          if (!set.has(nk) || seen.has(nk)) continue;
          if (!compatible(cur, nk)) continue;
          seen.add(nk);
          stack.push(nk);
        }
      }
      const gi = groups.length;
      groups.push({ rep: Math.min(...comp), blocks: comp, chunk: c.key });
      for (const b of comp) blockToGroup.set(b, gi);
    }
  }

  // ② 组级并查集（跨 chunk 合并）
  const parent = new Int32Array(groups.length);
  for (let i = 0; i < groups.length; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; }
    return r;
  };
  // 组间相邻边
  const edges = new Map<number, Set<number>>();
  for (const [b, gi] of blockToGroup) {
    const bx = keyToX(b), bz = keyToZ(b);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const gj = blockToGroup.get(bk(bx + dx, bz + dz));
      if (gj === undefined || gj === gi) continue;
      let s = edges.get(gi);
      if (!s) { s = new Set<number>(); edges.set(gi, s); }
      s.add(gj);
    }
  }
  // 组水位（组内 min）
  const groupLevel = new Map<number, number>();
  for (let i = 0; i < groups.length; i++) {
    let lv: number | undefined;
    for (const b of groups[i].blocks) {
      const v = levelOf.get(b);
      if (v !== undefined && (lv === undefined || v < lv)) lv = v;
    }
    if (lv !== undefined) groupLevel.set(i, lv);
  }
  for (const [gi, others] of edges) {
    const la = groupLevel.get(gi);
    for (const gj of others) {
      const lb = groupLevel.get(gj);
      if (la !== undefined && lb !== undefined && Math.abs(la - lb) > LEVEL_MERGE_TOLERANCE) continue;
      const ra = find(gi), rb = find(gj);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }

  // ③ 归集
  const out = new Map<number, BodyOut>();
  for (let i = 0; i < groups.length; i++) {
    const root = find(i);
    let body = out.get(root);
    if (!body) {
      body = { rep: groups[i].rep, blocks: [], level: 0 };
      out.set(root, body);
    }
    for (const b of groups[i].blocks) body.blocks.push(b);
    if (body.rep > groups[i].rep) body.rep = groups[i].rep;
  }
  const result: BodyOut[] = [];
  for (const body of out.values()) {
    let lv = 0, known = false;
    for (const b of body.blocks) {
      const v = levelOf.get(b);
      if (v !== undefined && (!known || v < lv)) { lv = v; known = true; }
    }
    body.level = known ? lv : 0;
    result.push(body);
  }
  return result;
}

if (typeof self !== 'undefined') self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as { id: number; chunks: ChunkInput[] };
  const bodies = partition(msg.chunks);
  (self as unknown as Worker).postMessage({ id: msg.id, bodies });
};
