import fs from 'node:fs';

function analyze(file) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  const nodes = new Map();
  for (const n of p.nodes) nodes.set(n.id, n);
  const N = p.samples.length;
  const totalMs = (p.endTime - p.startTime) / 1000;
  const per = totalMs / Math.max(1, N);

  // 自耗时（samples 直方）
  const self = new Map();
  for (const id of p.samples) self.set(id, (self.get(id) ?? 0) + 1);
  const topSelf = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);

  // 最长连续同栈（卡顿帧 = 长时间停留某函数）
  const runs = new Map();
  let prev = -1, run = 0;
  for (const id of p.samples) {
    if (id === prev) run++;
    else { if (prev >= 0) runs.set(prev, Math.max(runs.get(prev) ?? 0, run)); prev = id; run = 1; }
  }
  runs.set(prev, Math.max(runs.get(prev) ?? 0, run));
  const topRuns = [...runs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  const fmt = (id) => {
    const n = nodes.get(id);
    if (!n) return `?${id}`;
    const cf = n.callFrame;
    const fn = cf.functionName || '(anonymous)';
    const short = (cf.url || '').replace('file:///', '').split('/').slice(-1)[0] || '';
    return `${fn} @ ${short}:${cf.lineNumber + 1}`;
  };

  console.log(`\n======== ${file}  samples=${N}  durMs=${totalMs.toFixed(0)}  per=${per.toFixed(3)}ms`);
  console.log('-- 自耗时 Top（含 GC=js 内部）');
  for (const [id, c] of topSelf) {
    console.log(`   ${(c * per).toFixed(1)}ms (${c}样)  ${fmt(id)}`);
  }
  console.log('-- 最长连续停留（卡顿帧）');
  for (const [id, c] of topRuns) {
    if (c < 5) break;
    console.log(`   连续 ${(c * per).toFixed(1)}ms (${c}样)  ${fmt(id)}`);
  }
}

for (const f of ['scripts/perf/data/run.cpuprofile', 'scripts/perf/data/cbt150.cpuprofile']) analyze(f);