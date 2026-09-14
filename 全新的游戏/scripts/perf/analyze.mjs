import fs from 'node:fs';

const SECS = ['chunks', 'ui', 'combat', 'ai', 'entity', 'post', 'phys'];

function pct(arr, p) {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.max(0, Math.min(a.length - 1, Math.floor((a.length - 1) * p)))];
}

for (const n of ['idle', 'run', 'cbt150']) {
  const d = JSON.parse(fs.readFileSync(`scripts/perf/data/${n}.json`, 'utf8'));
  const fr = d.data.frames;
  const N = fr.length;
  const wall = fr.map((f) => f[0]);
  const total = fr.map((f) => f[1]);
  const secsAvg = {};
  for (let i = 0; i < SECS.length; i++) {
    secsAvg[SECS[i]] = fr.reduce((s, f) => s + f[2][i], 0) / N;
  }
  const swarmAvg = fr.reduce((s, f) => s + f[3], 0) / N;
  const swarmRenderAvg = fr.reduce((s, f) => s + f[4], 0) / N;
  const nA = Math.round(fr.reduce((s, f) => s + f[5], 0) / N);
  const nE = Math.round(fr.reduce((s, f) => s + f[6], 0) / N);
  const nEnt = Math.round(fr.reduce((s, f) => s + f[7], 0) / N);
  const asmMax = Math.max(...fr.map((f) => f[8]));
  const hudMid = d.data.hudSamples[d.data.hudSamples.length >> 1].text;
  const fps = hudMid.match(/([\d.]+) FPS/)?.[1];
  const ud = hudMid.match(/更新 ([\d.]+) ms\s+渲染 ([\d.]+) ms/);
  const draws = hudMid.match(/绘制 (\d+) 调用\s+三角 (\d+)/);

  console.log(`\n======== ${n}  (${N} frames / ${(d.data.dur / 1000).toFixed(1)}s)  HUD-FPS=${fps} 实渲染帧=${(N / d.data.dur * 1000).toFixed(0)} f/s`);
  console.log(`  wall帧时 ms  均值=${(fr.reduce((s, f) => s + f[0], 0) / N).toFixed(2)}  p50=${pct(wall, 0.5).toFixed(2)}  p95=${pct(wall, 0.95).toFixed(2)}  p99=${pct(wall, 0.99).toFixed(2)}  最大=${pct(wall, 1).toFixed(2)}`);
  console.log(`  WorldUpdate ms 均值=${(fr.reduce((s, f) => s + f[1], 0) / N).toFixed(3)}  p95=${pct(total, 0.95).toFixed(2)}  p99=${pct(total, 0.99).toFixed(2)}  最大=${pct(total, 1).toFixed(2)}  (HUD 更新/渲染=${ud ? ud[1] + '/' + ud[2] : '?'})`);
  console.log(`  绘制调用=${draws?.[1]}  三角=${draws?.[2]}`);
  console.log(`  段均值ms: ${SECS.map((k) => `${k}=${secsAvg[k].toFixed(3)}`).join('  ')}`);
  console.log(`  蜂群=决策${swarmAvg.toFixed(3)} (+移动/分离/升降级) 批渲=${swarmRenderAvg.toFixed(3)}`);
  console.log(`  规模(均值): 代理${nA} 敌实体${nE} 物理记录${nEnt} 装配峰${asmMax.toFixed(1)}ms`);
  console.log(`  heap=${(d.data.heapNow / 1048576).toFixed(0)}MB gpu=${d.gpu?.renderer?.slice(0, 60)}`);

  const spike = (thrWall) => fr.map((f, i) => ({ i, wall: f[0], total: f[1] })).filter((x) => x.wall > thrWall);
  const top = fr.map((f, i) => ({ i, wall: f[0], total: f[1] })).sort((a, b) => b.wall - a.wall).slice(0, 5);
  console.log(`  >13ms尖峰帧数: ${spike(13).length}/${N}`);
  for (const s of top) {
    const f = fr[s.i];
    console.log(`    #${s.i} wall=${s.wall.toFixed(1)}ms  upd.total=${s.total.toFixed(2)}ms  段=[${SECS.map((k, j) => f[2][j].toFixed(2)).join(' ')}]  蜂群决策${f[3].toFixed(2)} 批渲${f[4].toFixed(2)}  nA=${f[5]} nE=${f[6]} nEnt=${f[7]} asm=${f[8].toFixed(1)}`);
  }
}