/**
 * audit-dead.mjs —— 死参数 / 死开关 / 未使用导出的静态审计
 * 用法：node .tmp/audit-dead.mjs
 */
import fs from 'node:fs';

const SRC = [
  'src/core/systems/balance.ts',
  'src/core/gaitState.ts',
  'src/core/systems/wantedForce.ts',
  'src/core/controller.ts',
  'src/core/rigState.ts',
  'src/core/ragdoll.ts',
  'src/core/skeleton.ts',
  'src/core/systems/step.ts',
];
const read = (p) => fs.readFileSync(p, 'utf8');
const ALL = SRC.map(read).join('\n');

/** 取 interface 的字段名 */
function fields(file, iface) {
  const s = read(file);
  const i = s.indexOf(`export interface ${iface}`);
  if (i < 0) return [];
  const body = s.slice(i, s.indexOf('\n}', i));
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
}

/** 统计"真正被读取"的次数：`p.x` / `rs.x` / `cfg.x` / `params.x` */
function reads(name) {
  const re = new RegExp(`\\b(?:p|rs|cfg|params|q|this\\.cfg)\\.${name}\\b`, 'g');
  return (ALL.match(re) || []).length;
}

let issues = 0;

// ══ 1. 死参数 ═══════════════════════════════════════════════════
for (const [f, iface] of [
  ['src/core/systems/balance.ts', 'BalanceParams'],
  ['src/core/systems/wantedForce.ts', 'WantedForceParams'],
]) {
  const fl = fields(f, iface);
  const dead = fl.filter((n) => reads(n) === 0);
  console.log(`\n=== ${iface}（${fl.length} 字段）===`);
  if (!dead.length) console.log('  无死参数');
  else {
    issues += dead.length;
    console.log(`  ⚠ 从未被读取（${dead.length}）:`);
    for (const n of dead) console.log(`      ${n}`);
  }
}

// ══ 2. 消融开关接线 ═══════════════════════════════════════════════
console.log('\n=== 消融通道：声明 vs 接线 ===');
{
  const bs = read('src/core/systems/balance.ts');
  const declared = [...bs.matchAll(/on\('(\w+)'\)/g)].map((m) => m[1]);
  const all = [...new Set(declared)].sort();
  const probe = fs.existsSync('tools/probe-axisown.ts')
    ? read('tools/probe-axisown.ts') : '';
  const gateList = (probe.match(/ALL_CHANNELS = [^[]*\[([\s\S]*?)\]/) || [, ''])[1];
  const gated = [...gateList.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  console.log(`  代码里 on() 用到的: ${all.join(', ')}`);
  console.log(`  门禁 ALL_CHANNELS:  ${gated.join(', ')}`);
  const missing = all.filter((c) => !gated.includes(c));
  const extra = gated.filter((c) => !all.includes(c));
  if (missing.length) { issues += missing.length; console.log(`  ⚠ 用了但门禁没覆盖: ${missing.join(', ')}`); }
  if (extra.length) { issues += extra.length; console.log(`  ⚠ 门禁里有但代码没用: ${extra.join(', ')}`); }
  if (!missing.length && !extra.length) console.log('  ✓ 一一对应');
}

// ══ 3. 未使用的导出 ═════════════════════════════════════════════
console.log('\n=== 未被其它模块引用的导出 ===');
{
  const files = fs.readdirSync('src/core').flatMap((d) => {
    const p = `src/core/${d}`;
    return fs.statSync(p).isDirectory()
      ? fs.readdirSync(p).filter((f) => f.endsWith('.ts')).map((f) => `${p}/${f}`)
      : (p.endsWith('.ts') ? [p] : []);
  });
  const toolFiles = fs.existsSync('tools')
    ? fs.readdirSync('tools').filter((f) => /\.(ts|mjs)$/.test(f)).map((f) => `tools/${f}`)
    : [];
  const consumers = files.concat(toolFiles).map(read).join('\n')
    + read('src/ui/hud.ts') + read('index.html');
  const unused = [];
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/^export (?:const|function|class|interface|type) (\w+)/gm)) {
      const n = m[1];
      const re = new RegExp(`\\b${n}\\b`, 'g');
      const total = (consumers.match(re) || []).length;
      if (total <= 1) unused.push(`${f.replace('src/core/', '')}:${n}`);
    }
  }
  if (!unused.length) console.log('  无');
  else { issues += unused.length; for (const u of unused) console.log(`  ⚠ ${u}`); }
}

console.log(`\n${issues ? `共 ${issues} 处` : '干净'}`);