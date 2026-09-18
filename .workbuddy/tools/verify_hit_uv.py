# -*- coding: utf-8 -*-
"""验证 hitUvOf：把真实 CharacterBase 用项目 esbuild 打进 node 直跑，按真实敌人几何做断言。
不启动游戏（不抢 GPU）。"""
import gzip, importlib.util, json, os, re, shutil, subprocess, sys, tempfile

ROOT = r'C:\Users\22641\Desktop\架构重置\全新的游戏'
TOOL = r'C:\Users\22641\Desktop\架构重置\.workbuddy\tools\ftx_foot_measure.py'
TMP = r'C:\Users\22641\Desktop\架构重置\.workbuddy\tmp'
NODE_DIR = r'C:\Users\22641\.workbuddy\binaries\node\versions\22.22.2-3'
NODE = os.path.join(NODE_DIR, 'node.exe')

env = dict(os.environ)
env['PATH'] = NODE_DIR + os.pathsep + env.get('PATH', '')

# --- 1. 载入离线度量工具 ---
spec = importlib.util.spec_from_file_location('ffm', TOOL)
ffm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ffm)

# --- 2. 解析名册（id / file / scale）---
roster_src = open(os.path.join(ROOT, 'src', 'config', 'enemyRoster.ts'), encoding='utf-8').read()
specs = []
for blk in roster_src.split("id: '")[1:]:
    eid = blk.split("'", 1)[0]
    mfile = re.search(r"file:\s*'([^']+)'", blk[:900])
    mscale = re.search(r"scale:\s*([0-9.]+)", blk[:900])
    if mfile and mscale:
        specs.append((eid, mfile.group(1), float(mscale.group(1))))
if not specs:
    print('!! 名册解析失败'); sys.exit(1)

# --- 3. 测每个包的真实 bbox ---
ENEMY_DIR = os.path.join(ROOT, 'public', 'characters', 'enemies')
cases = []
for eid, fn, sc in specs:
    p = os.path.join(ENEMY_DIR, fn)
    if not os.path.exists(p):
        print('  skip (缺素材) %s' % fn); continue
    m = ffm.measure(p, sc)
    if m.get('empty'):
        continue
    bw, bh = m['bbox'][2], m['bbox'][3]
    W = sc                      # quad 世界宽 = scale
    H = sc * bh / bw            # quad 世界高 = scale × 宽高比
    cases.append(dict(id=eid, file=fn, scale=sc, bbox=[bw, bh], W=W, H=H))

print('名册 %d 条，测到 %d 个包的几何' % (len(specs), len(cases)))

# --- 4. esbuild 打包真实 CharacterBase ---
os.makedirs(TMP, exist_ok=True)
entry = os.path.join(TMP, '_hp_entry.ts')
open(entry, 'w', encoding='utf-8').write(
    "export { CharacterBase } from '%s';\n" % os.path.join(ROOT, 'src', 'entity', 'CharacterBase').replace('\\', '/'))
out = os.path.join(TMP, '_hp_bundle.cjs')

def find_esbuild():
    cands = [
        os.path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
        os.path.join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
        os.path.join(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js'),
    ]
    for c in cands:
        if os.path.exists(c):
            return c
    return None

eb = find_esbuild()
if not eb:
    print('!! 找不到 esbuild'); sys.exit(1)
bcmd = ([NODE, eb] if eb.endswith('.js') or eb.endswith('esbuild') and not eb.endswith('.exe') else [eb])
bcmd += [entry, '--bundle', '--format=cjs', '--platform=node', '--outfile=' + out,
         '--log-level=warning', '--loader:.ts=ts']
bp = subprocess.run(bcmd, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
print('esbuild RC %d %s' % (bp.returncode, bp.stdout.decode('utf-8', 'replace')[:600]))
if bp.returncode != 0 or not os.path.exists(out):
    sys.exit(1)

# --- 5. node 侧调用真实函数并断言 ---
open(os.path.join(TMP, '_hp_cases.json'), 'w', encoding='utf-8').write(json.dumps(cases, ensure_ascii=False))
test = os.path.join(TMP, '_hp_test.cjs')
open(test, 'w', encoding='utf-8').write(r'''
const fs = require('fs');
const mod = require('./_hp_bundle.cjs');
const CB = mod.CharacterBase;
if (!CB || typeof CB.prototype.hitUvOf !== 'function') {
  console.log('!! hitUvOf 不可见：' + (CB ? Object.getOwnPropertyNames(CB.prototype).join(',') : 'no CharacterBase'));
  process.exit(2);
}
const cases = JSON.parse(fs.readFileSync('./_hp_cases.json', 'utf8'));
const EPS = 1e-6;
let fail = 0, n = 0;
function call(point, sx, sy) {
  const W = sx, H = sy;
  const fake = { renderer: { mesh: { position: { x: 100, y: 5, z: 0 }, scale: { x: sx, y: sy } } } };
  return CB.prototype.hitUvOf.call(fake, point);
}
function chk(label, got, want, field) {
  n++;
  const v = got[field];
  const ok = Math.abs(v - want) < 1e-4;
  if (!ok) { fail++; console.log('  FAIL %s: %s=%s 期望 %s', label, field, v.toFixed(4), want); }
  return ok;
}
const rows = [];
for (const c of cases) {
  const W = c.W, H = c.H;
  const CX = 100, CY = 5;
  const res = {};
  res.left   = call({ x: CX - 0.35 * W, y: CY }, W, H);
  res.right  = call({ x: CX + 0.35 * W, y: CY }, W, H);
  res.farL   = call({ x: CX - 3 * W,     y: CY }, W, H);
  res.farR   = call({ x: CX + 3 * W,     y: CY }, W, H);
  res.mirror = call({ x: CX - 0.35 * W, y: CY }, -W, H);
  res.feet   = call({ x: CX, y: CY - H / 2 }, W, H);
  res.head   = call({ x: CX, y: CY + H / 2 }, W, H);
  res.flipY  = call({ x: CX, y: CY - H / 2 }, W, -H);
  res.third  = call({ x: CX, y: CY + 0.1 * H }, W, H);
  const P = c.id;
  chk(P + ' 左侧命中', res.left, 0.15, 'x');
  chk(P + ' 右侧命中', res.right, 0.85, 'x');
  chk(P + ' 远处左侧夹取', res.farL, 0.12, 'x');
  chk(P + ' 远处右侧夹取', res.farR, 0.88, 'x');
  chk(P + ' 镜像后左侧命中→右侧', res.mirror, 0.85, 'x');
  chk(P + ' 脚部→夹取 0.85', res.feet, 0.85, 'y');
  chk(P + ' 头顶→夹取 0.08', res.head, 0.08, 'y');
  chk(P + ' Y 翻转后脚部→顶部', res.flipY, 0.08, 'y');
  chk(P + ' 躯干中段 v≈0.4', res.third, 0.4, 'y');
  chk(P + ' 水平中线 v=0.5', res.left, 0.5, 'y');
  rows.push([P, c.scale, c.bbox.join('x'), W.toFixed(2), H.toFixed(2),
             res.left.x.toFixed(3), res.right.x.toFixed(3), res.feet.y.toFixed(3)]);
}
// 回退分支
for (const [label, arg, ren] of [['无命中点', undefined, true], ['无 renderer', { x: 100, y: 5 }, false]]) {
  const fake = ren ? { renderer: { mesh: { position: { x: 100, y: 5, z: 0 }, scale: { x: 2, y: 3 } } } } : {};
  const r = CB.prototype.hitUvOf.call(fake, arg);
  n++;
  const ok = r.x >= 0.4 && r.x <= 0.6 && r.y >= 0.25 && r.y <= 0.45;
  if (!ok) { fail++; console.log('  FAIL 回退(%s) 越界 %o', label, r); }
}
console.log('\n%-26s %5s %9s %6s %6s | %7s %7s %7s', 'id', 'scale', 'bbox', 'quadW', 'quadH', 'u(左)', 'u(右)', 'v(脚)');
console.log('-'.repeat(92));
for (const r of rows) console.log('%-26s %5.2f %9s %6s %6s | %7s %7s %7s', ...r);
console.log('断言 %d 项，失败 %d 项', n, fail);
process.exit(fail ? 1 : 0);
''')

tp = subprocess.run([NODE, test], cwd=TMP, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
print(tp.stdout.decode('utf-8', 'replace'))
print('-> RC %d' % tp.returncode)
sys.exit(tp.returncode)
