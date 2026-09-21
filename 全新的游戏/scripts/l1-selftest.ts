// ============================================================
// L1 语义表无头自测（合成地形 → 断言 + 回读指标）
// 运行：npx esbuild scripts/l1-selftest.ts --bundle --platform=node --format=esm --outfile=scripts/tmp/l1-selftest.mjs && node scripts/tmp/l1-selftest.mjs
// ============================================================
import { TerrainSemantics, Sem, SEM_NAMES, type FieldSampler } from '../src/systems/swarm/TerrainSemantics';
import { HoleMask } from '../src/systems/swarm/HoleMask';
import { HoleTable, HOLE_MIN_DEPTH, HOLE_FULL_DEPTH, HOLE_NEAR_R, HOLE_FAR_R } from '../src/systems/swarm/HoleTable';

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

// ---- 5) 坑洞管线：独立掩码 HoleMask（挖改）→ 敌用动态表 HoleTable（深×近打分）----
{
  console.log('\n[5] 坑洞（掩码独立 + 敌用动态公式表）');
  // L1 = 纯初始地形：平坦 ground，无坑无破坏（下水换区测初始破坏进掩码）
  const mask = new HoleMask();
  // 真源 = 函数式破坏场（模拟 RasterMap.levelDepthAt，坐标为 4m 格中心）
  const inA = (x: number, z: number) => x > -44 && x < -16 && z > -44 && z < -16;   // A 窝
  const digOf = (x: number, z: number) =>
    x > 0 && x <= 4 && z > 0 && z <= 4 ? 1.2 : inA(x, z) ? 0.6 : 0;
  mask.build({ digDepthAt: (x, z) => digOf(x, z) }, 0, 0);
  const sem = new TerrainSemantics();
  sem.build(field(() => 0), 0, 0);
  const holes = new HoleTable();
  // a) 初始破坏（掩码独立于语义表）：开局既有坑 → build 首扫算进掩码；L1 类不受影响
  ok(mask.isDug(-30, -30), '掩码识别初始破坏格');
  ok(Math.abs(mask.depthAt(-30, -30) - 0.6) < 0.01, '掩码记录挖掘深度');
  ok(sem.classAt(-30, -30) === Sem.Open, 'L1 纯初始：破坏格仍是平地类（不改变语义类）');
  ok(sem.stats().hist['开阔地'] === 5329, 'L1 hist 无破坏桶（12 类）');
  ok(SEM_NAMES.length === 12, 'SEM_NAMES 共 12 类（战壕已剥离）');
  // b) 打分：近+深 → 高分；深但远 → 分塌；浅但近 → 分塌
  holes.rebuild(mask, sem, 3, 3);        // 玩家贴近满深探针格 (2,2)=1.2m
  const sProbe = holes.scoreAt(2, 2);     // 深满 × 近(<40m) = 高分
  const sMid = holes.scoreAt(-30, -30);   // 深半(0.6) × 距 45m(≈0.9) = 中分
  ok(sProbe > 0.9, `近处满深坑 → 高分（${sProbe.toFixed(3)}）`);
  ok(sMid < sProbe, `更浅更远的窝分更低（${sMid.toFixed(3)} < ${sProbe.toFixed(3)}）`);
  const hole = holes.holes[0];
  ok(!!hole && hole.cells === 1 && Math.abs(hole.maxDepth - 1.2) < 0.01, '满深探针独立成坑（cells=1，最深 1.2）');
  ok(hole.score === sProbe, '坑洞分 = 块内最高格分');
  holes.rebuild(mask, sem, 500, 500);    // 玩家远离 → 全表分塌为 0
  ok(holes.scoreAt(2, 2) <= 0.001, `远处满深坑分塌为 0（${holes.scoreAt(2, 2).toFixed(3)}）`);
  const holeFar = holes.holes[0];
  ok(!holeFar || holeFar.score <= 0.001, '远离玩家 → 无有效高分坑洞条目');
  holes.rebuild(mask, sem, 3, 3);        // 恢复高分态（验证"动态不断修改"）
  const sBack = holes.scoreAt(2, 2);
  ok(sBack > 0.9, '动态表随玩家靠近回升');
  // c) 浅坑（0.1m < 0.3m 门槛）→ 无坑洞条目
  const shallow = new HoleMask();
  shallow.build({ digDepthAt: () => 0.1 }, 0, 0);
  shallow.refresh(50, 50, 40);
  holes.rebuild(shallow, sem, 0, 0);
  ok(holes.holes.length === 0, '浅坑（<0.3m）不构成有效坑洞');
  ok(holes.scoreAt(50, 50) === 0, '浅坑格分 = 0');
  // d) 满分布深 ⇔ 分近临界（验证常数关系：无关点）
  ok(HOLE_FULL_DEPTH > HOLE_MIN_DEPTH, '满分布深 > 门槛');
  ok(HOLE_NEAR_R < HOLE_FAR_R, '近满 > 远零半径');
  // e) 掩体（构造工事）也动态计算：遮蔽×距离 打分 + 排序 + 销毁即清空
  const covs = [
    { x: 10, z: 10, hp: 400, variant: 'cover', heading: 0, hidden: true },    // 近 + 挡射界
    { x: 12, z: 12, hp: 400, variant: 'cover', heading: 0, hidden: false },   // 近 + 暴露
    { x: 300, z: 300, hp: 400, variant: 'wall', heading: 0, hidden: true },   // 远（距离因子=0）
  ];
  holes.rebuild(mask, sem, 0, 0, covs);
  const cs = holes.covers;
  ok(cs.length === 3, '掩体条目随重排动态更新');
  ok(cs[0].x === 10 && cs[0].hidden, '遮蔽近掩体排第一');
  ok(cs[0].score > cs[1].score && cs[1].score > cs[2].score,
    `掩体分：遮蔽>暴露>远（${cs[0].score.toFixed(2)}/${cs[1].score.toFixed(2)}/${cs[2].score.toFixed(2)}）`);
  holes.rebuild(mask, sem, 0, 0, []);   // 掩体全毁 → 条目清空
  ok(holes.covers.length === 0, '掩体销毁后动态表清空');
  console.log('  探针(近满深) =', sProbe.toFixed(3), ' 中窝 =', sMid.toFixed(3),
    ' 回表 =', sBack.toFixed(3), ' 坑洞数 =', holes.holes.length);
}

console.log(`\n==== 结果：PASS ${pass} / FAIL ${fail} ====`);
if (fail > 0) process.exit(1);
