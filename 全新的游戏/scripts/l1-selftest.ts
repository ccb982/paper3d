// ============================================================
// L1 语义表无头自测（合成地形 → 断言 + 回读指标）
// 运行：npx esbuild scripts/l1-selftest.ts --bundle --platform=node --format=esm --outfile=scripts/tmp/l1-selftest.mjs && node scripts/tmp/l1-selftest.mjs
// ============================================================
import { TerrainSemantics, Sem, SEM_NAMES, type FieldSampler } from '../src/systems/swarm/TerrainSemantics';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = ''): void {
  if (cond) { pass++; console.log(`  PASS  ${msg}`); }
  else { fail++; console.log(`  FAIL  ${msg}${extra ? '  ← ' + extra : ''}`); }
}

function field(hAt: (x: number, z: number) => number, roleAt: (x: number, z: number) => string = () => 'ground'): FieldSampler {
  return { heightAt: hAt, roleAt };
}

function histOf(s: ReturnType<TerrainSemantics['stats']>): string {
  return SEM_NAMES.map((n) => `${n}:${s.hist[n]}`).join('  ');
}

// ---- 1) 平原：开阔地主导，无高地/关口 ----
{
  console.log('\n[1] 平原');
  const l1 = new TerrainSemantics();
  l1.build(field(() => 0), 0, 0);
  const s = l1.stats();
  console.log('  stats:', JSON.stringify({ ms: s.buildMs, passable: s.passable, regions: s.regionCount, concealed: s.concealed }));
  console.log('  hist: ', histOf(s));
  ok(s.hist['开阔地'] > s.passable * 0.5, '开阔地占可站格 >50%', `开阔地=${s.hist['开阔地']} passable=${s.passable}`);
  ok(l1.regionsOf(Sem.HighGround).length === 0, '无高地区块');
  ok(l1.regionsOf(Sem.Choke).length === 0, '无关口区块');
}

// ---- 2) 高斯山：高地 + 迎/背船坡 + 隐蔽 ----
{
  console.log('\n[2] 高斯山（峰在舰船北侧 60m，高 25m，σ=30）');
  const hill = (x: number, z: number): number => {
    const r2 = x * x + (z + 60) * (z + 60);
    return 25 * Math.exp(-r2 / (2 * 30 * 30));
  };
  const l1 = new TerrainSemantics();
  l1.build(field(hill), 0, 0);
  const s = l1.stats();
  console.log('  stats:', JSON.stringify({ ms: s.buildMs, regions: s.regionCount, concealed: s.concealed }));
  console.log('  hist: ', histOf(s));
  const highs = l1.regionsOf(Sem.HighGround);
  const top = highs[0];
  if (top) console.log(`  高地区块: area=${top.area} rep=(${top.rx.toFixed(0)},${top.rz.toFixed(0)}) h=[${top.minH.toFixed(1)},${top.maxH.toFixed(1)}]`);
  ok(highs.length > 0, '存在高地区块');
  ok(!!top && Math.hypot(top.rx - 0, top.rz + 60) <= 16, '高地区块代表点在山顶 16m 内', top ? `rep=(${top.rx.toFixed(0)},${top.rz.toFixed(0)})` : 'none');
  ok(s.hist['迎船坡'] > 0, '有迎船坡格');
  ok(s.hist['背船坡'] > 0, '有背船坡格');
  // 迎/背坡向符号：抽样找迎船坡与背船坡格
  let aspFront = 0, aspBack = 0, nF = 0, nB = 0;
  for (let z = -140; z <= 140; z += 4) {
    for (let x = -140; x <= 140; x += 4) {
      const c = l1.classAt(x, z) as Sem;
      if (c === Sem.FrontSlope) { aspFront += l1.aspectAt(x, z); nF++; }
      if (c === Sem.ReverseSlope) { aspBack += l1.aspectAt(x, z); nB++; }
    }
  }
  ok(nF > 0 && aspFront / nF > 0.3, `迎船坡平均坡向 > +0.3（n=${nF}）`, `mean=${(aspFront / Math.max(1, nF)).toFixed(2)}`);
  ok(nB > 0 && aspBack / nB < -0.3, `背船坡平均坡向 < -0.3（n=${nB}）`, `mean=${(aspBack / Math.max(1, nB)).toFixed(2)}`);
  ok(l1.concealedAt(0, -140), '山后 (0,-140) 判定为隐蔽（LOS 被山挡）');
  ok(!l1.concealedAt(0, 80), '舰船南侧 (0,80) 不隐蔽');
}

// ---- 3) 横脊 + 单格门：关口 + 隐蔽区 + 门后可见 ----
{
  console.log('\n[3] 横脊（z=-42..-38，高 20m）+ 单格门（x=2）');
  const ridge = (x: number, z: number): number => {
    const inBand = Math.abs(z + 40) <= 3;
    if (inBand && Math.abs(x - 2) < 2) return 0;   // 门
    return inBand ? 20 : 0;
  };
  const l1 = new TerrainSemantics();
  l1.build(field(ridge), 0, 0);
  const s = l1.stats();
  console.log('  stats:', JSON.stringify({ ms: s.buildMs, regions: s.regionCount, concealed: s.concealed }));
  console.log('  hist: ', histOf(s));
  ok(l1.concealedAt(30, -60), '脊后 (30,-60) 隐蔽');
  ok(!l1.concealedAt(2, -60), '门后 (2,-60) 不隐蔽（可穿过门看到）');
  ok(s.hist['隐蔽'] > 0, '有隐蔽格（背脊侧）');
}

// ---- 3b) 双峰鞍部：关口（真实山口，可走） ----
{
  console.log('\n[3b] 双峰鞍部（两峰 (-14,-40)/(18,-40) 高 20m，σ=8）');
  const saddle = (x: number, z: number): number => {
    const a = Math.exp(-(((x + 14) ** 2 + (z + 40) ** 2)) / (2 * 8 * 8));
    const b = Math.exp(-(((x - 18) ** 2 + (z + 40) ** 2)) / (2 * 8 * 8));
    return 20 * (a + b);
  };
  const l1 = new TerrainSemantics();
  l1.build(field(saddle), 0, 0);
  const s = l1.stats();
  console.log('  stats:', JSON.stringify({ ms: s.buildMs, regions: s.regionCount }));
  console.log('  hist: ', histOf(s));
  const chokes = l1.regionsOf(Sem.Choke);
  for (const r of chokes.slice(0, 3)) console.log(`  关区块: area=${r.area} rep=(${r.rx.toFixed(0)},${r.rz.toFixed(0)}) h=[${r.minH.toFixed(1)},${r.maxH.toFixed(1)}]`);
  ok(chokes.length > 0, '存在关口区块（鞍部）');
  ok(!!chokes[0] && Math.abs(chokes[0].rx - 2) <= 10 && Math.abs(chokes[0].rz + 40) <= 12, '关口区块在两峰之间', chokes[0] ? `rep=(${chokes[0].rx.toFixed(0)},${chokes[0].rz.toFixed(0)})` : 'none');
  ok(l1.isPassableAt(2, -40), '鞍部可走');
}

// ---- 4) 坑 / 水：role 硬类 ----
{
  console.log('\n[4] 坑 / 水');
  const roleAt = (x: number, z: number): string => {
    if (x > 40 && x < 80 && z > 40 && z < 80) return 'pit';
    if (x < -40 && x > -80 && z > 40 && z < 80) return 'liquid';
    return 'ground';
  };
  const l1 = new TerrainSemantics();
  l1.build(field(() => 0, roleAt), 0, 0);
  const s = l1.stats();
  console.log('  hist: ', histOf(s));
  ok(l1.classAt(60, 60) === Sem.Pit, '坑区 → 坑类');
  ok(l1.classAt(-60, 60) === Sem.Water, '水区 → 水类');
  ok(!l1.isPassableAt(60, 60), '坑不可走');
  ok(l1.isPassableAt(-60, 60), '水可走');
}

console.log(`\n==== 结果：PASS ${pass} / FAIL ${fail} ====`);
if (fail > 0) process.exit(1);
