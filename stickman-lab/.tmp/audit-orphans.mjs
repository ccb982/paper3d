/**
 * audit-orphans.mjs —— 画出从 src/main.ts 出发的活动 import 图，
 * 列出**不在活动路径里**的 src/core 模块。
 * 用途：区分"死代码"与"仍在运行的平行实现"。后者才是危险的。
 */
import fs from 'node:fs';
import path from 'node:path';

const seen = new Set();
const order = [];
const edges = [];

function resolve(from, spec) {
  const abs = path.relative(process.cwd(), path.resolve(path.dirname(from), spec)).replace(/\\/g, '/');
  for (const c of [abs + '.ts', abs + '/index.ts']) if (fs.existsSync(c)) return c;
  return null;
}

function walk(f) {
  if (seen.has(f) || !fs.existsSync(f)) return;
  seen.add(f);
  order.push(f);
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/from '(\.[^']+)'/g)) {
    const t = resolve(f, m[1]);
    if (t) { edges.push([f, t]); walk(t); }
  }
}
walk('src/main.ts');

const list = (d) => fs.readdirSync(d).flatMap((n) => {
  const p = `${d}/${n}`;
  return fs.statSync(p).isDirectory()
    ? (fs.readdirSync(p).filter((x) => x.endsWith('.ts')).map((x) => `${p}/${x}`))
    : (p.endsWith('.ts') ? [p] : []);
});

const all = list('src/core').concat(list('src').filter((f) => f.endsWith('.ts')));
const orphan = all.filter((f) => !seen.has(f));

console.log(`活动路径（从 src/main.ts 出发）：${order.length} 个模块`);
console.log(order.map((f) => '  ' + f).join('\n'));
console.log(`\n★ 不在活动路径里的模块（${orphan.length}）：`);
for (const o of orphan) console.log('   ' + o);

console.log(`\n每个孤立模块的反向引用（谁还在 import 它）：`);
for (const o of orphan) {
  const refs = edges.filter(([, t]) => t === o).map(([f]) => f);
  console.log(`  ${o}: ${refs.length ? refs.join(', ') : '（无）'}`);
}