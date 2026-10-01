// ============================================================
// measure-size —— 体积核算（预算口径：我的纹理 + 数据 < 1 MB）
// ============================================================
// 口径来自用户定稿："three.js 和 rapier 不算，我的纹理 + 数据在 1mb 以内就行"。
//
//   计入预算：public/parts/*.webp（10 张海猫组件）、src/data/parts.json、
//             训练好的基因组存档（要烤进隐藏 boss 的那份"数据"）。
//   不计入：  Three.js、@dimforge/rapier3d（渲染/物理引擎，与本体共用）。
//
// 三种口径都打印：raw（磁盘原始）、gzip(-9)、brotli(-q11)。
// Web 服务器对 .wasm/.js/.json 一般开 gzip 或 brotli，纹理（webp）本身已压缩，
// 再套 gzip 只涨不跌 —— 所以看"计入预算"那行时，raw 与 br 都要看。
//
// 跑法：node tools/measure-size.mjs   （或 npm run size）

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET = 1024 * 1024; // 1 MiB

const gz = (buf) => zlib.gzipSync(buf, { level: 9 });
const br = (buf) =>
  zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function stats(file) {
  const buf = fs.readFileSync(file);
  return { raw: buf.length, gz: gz(buf).length, br: br(buf).length };
}

const kb = (n) => (n / 1024).toFixed(1).padStart(8);
const pct = (n) => `${((n / BUDGET) * 100).toFixed(1)}%`;

function report(title, files, note) {
  const rows = files.map((f) => ({ name: path.relative(ROOT, f).replace(/\\/g, '/'), ...stats(f) }));
  const sum = rows.reduce((a, r) => ({ raw: a.raw + r.raw, gz: a.gz + r.gz, br: a.br + r.br }), {
    raw: 0, gz: 0, br: 0,
  });

  console.log(`\n── ${title} ──${note ? `  （${note}）` : ''}`);
  console.log('  文件                                    raw       gzip     brotli');
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(38)} ${kb(r.raw)} ${kb(r.gz)} ${kb(r.br)}`);
  }
  console.log(`  ${'合计'.padEnd(36)} ${kb(sum.raw)} ${kb(sum.gz)} ${kb(sum.br)}   KB`);
  return sum;
}

// ---------------------------------------------------------------- 基因组存档口径
// 从 brain.ts 里读网络形状，算出参数个数与 base64 存档长度（不依赖 TS 编译）。
function genomeSize() {
  const src = fs.readFileSync(path.join(ROOT, 'src/core/brain.ts'), 'utf8');
  const m = src.match(/inputs:\s*(\d+)\s*,\s*hidden:\s*(\d+)\s*,\s*outputs:\s*(\d+)/);
  if (!m) return null;
  const [i, h, o] = [+m[1], +m[2], +m[3]];
  const params = (i + 1) * h + (h + 1) * o;
  const bytes = params * 4; // float32
  const b64 = 4 * Math.ceil(bytes / 3);
  const envelope = 64; // {"v":1,"shape":[...],"meta":{...},"data":"..."}
  return { i, h, o, params, bytes, file: b64 + envelope };
}

// ---------------------------------------------------------------- 执行
console.log('stickman-lab 体积核算');
console.log(`预算口径：我的纹理 + 数据 < 1 MiB（${BUDGET} B）；three.js / rapier 不计入`);

const texFiles = walk(path.join(ROOT, 'public/parts')).filter((f) => /\.(webp|png|jpg)$/i.test(f));
const dataFiles = walk(path.join(ROOT, 'src/data'));

const tex = report('计入预算：纹理', texFiles, `${texFiles.length} 张`);
const dat = report('计入预算：数据', dataFiles);

const g = genomeSize();
if (g) {
  console.log(`\n── 计入预算：训练基因组（烤进隐藏 boss，不进仓库磁盘但会进包） ──`);
  console.log(`  网络 ${g.i}→${g.h}→${g.o}  参数 ${g.params} 个 float32 = ${g.bytes} B`);
  console.log(`  base64 + JSON 外壳 ≈ ${g.file} B (${(g.file / 1024).toFixed(2)} KB)`);
}

const ownRaw = tex.raw + dat.raw + (g ? g.file : 0);
const ownBr = tex.br + dat.br + (g ? g.file : 0);

console.log('\n════════════════════════════════════════════════════════');
console.log(`  ★ 计入预算合计（raw）    ${kb(ownRaw)} KB   = 预算的 ${pct(ownRaw)}`);
console.log(`  ★ 计入预算合计（brotli） ${kb(ownBr)} KB   = 预算的 ${pct(ownBr)}`);
console.log(`    余量（raw 口径）       ${kb(BUDGET - ownRaw)} KB`);
console.log(`    判定：${ownRaw < BUDGET ? '✔ 在 1 MB 以内' : '✘ 超出预算'}`);

// ---------------------------------------------------------------- 参考：不计入的部分
console.log('\n── 参考（不计入预算）：引擎体积 ──');
const engineFiles = [];
for (const rel of [
  '../全新的游戏/node_modules/@dimforge/rapier3d/rapier_wasm3d_bg.wasm',
  '../全新的游戏/node_modules/three/build/three.module.js',
  '../全新的游戏/node_modules/three/build/three.core.js',
]) {
  const p = path.resolve(ROOT, rel);
  if (fs.existsSync(p)) engineFiles.push(p);
}
if (engineFiles.length) {
  const eng = engineFiles.map((f) => ({ name: path.basename(f), ...stats(f) }));
  for (const r of eng) console.log(`  ${r.name.padEnd(38)} ${kb(r.raw)} ${kb(r.gz)} ${kb(r.br)}`);
  const es = eng.reduce((a, r) => ({ raw: a.raw + r.raw, gz: a.gz + r.gz, br: a.br + r.br }), { raw: 0, gz: 0, br: 0 });
  console.log(`  ${'合计'.padEnd(36)} ${kb(es.raw)} ${kb(es.gz)} ${kb(es.br)}   KB`);
} else {
  console.log('  （未找到本体的 node_modules，跳过）');
}

// ---------------------------------------------------------------- 参考：整包 dist
const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  const dist = report('参考：整包 dist（含引擎，仅信息）', walk(distDir));
  console.log(`  整包 gzip ${(dist.gz / 1024).toFixed(1)} KB / brotli ${(dist.br / 1024).toFixed(1)} KB`);
} else {
  console.log('\n（dist/ 不存在 —— 跑 npm run build 后可看到整包体积）');
}
