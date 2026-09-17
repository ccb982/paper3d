# -*- coding: utf-8 -*-
"""扫描压缩参数：目标是「同样峰值上限下 RMS 最大」= 听感最响且不削波。
   流程：基准信号(bass+aecho) → 压缩 → 线性归一到 peak 0.95 → 测 RMS。
"""
import os, shutil, subprocess, tempfile, array, math, itertools

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
TMP = os.path.join(tempfile.gettempdir(), 'ship_raw')
RAW = os.path.join(TMP, '757.mp3')


def run(args):
    r = subprocess.run([FF, '-y'] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('FAIL\n', (r.stderr or '')[-800:]); raise SystemExit(1)


def measure(path):
    r = subprocess.run([FF, '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True)
    a = array.array('h'); a.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
    rms = (sum(float(v) * v for v in a) / max(1, len(a))) ** 0.5 / 32768
    pk = max(abs(float(v)) for v in a) / 32768 if len(a) else 0.0
    return rms, pk


def build(base_af, comp, tag):
    p1 = os.path.join(TMP, f'sc_{tag}_a.mp3')
    af = base_af + (',' + comp if comp else '')
    run(['-i', RAW, '-af', af, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', p1])
    r0, pk0 = measure(p1)
    p2 = os.path.join(TMP, f'sc_{tag}_b.mp3')
    gain = 0.95 / max(1e-6, pk0)
    run(['-i', p1, '-af', f'volume={gain:.4f}', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', p2])
    return measure(p2) + (gain,)


BASE = 'bass=g=12:f=110:w=0.7,aecho=0.8:0.88:150|320:0.20|0.12'
print(f'{"ratio":>6} {"thr":>6} {"makeup":>7} | {"rms":>7} {"peak":>6} {"crest":>6}  dB vs 基准')
best = None
rows = []
base_rms, base_pk, _ = build(BASE, None, 'base')
print(f'{"-":>6} {"-":>6} {"-":>7} | {base_rms:.4f} {base_pk:.3f} {base_pk/base_rms:6.2f}  +0.0dB (不压缩)')
for ratio, thr, mk in itertools.product([6, 12, 20, 30], [0.02, 0.06, 0.12], [0, 4, 8]):
    comp = f'acompressor=threshold={thr}:ratio={ratio}:attack=2:release=200'
    if mk:
        comp += f':makeup={mk}'
    tag = f'{ratio}_{thr}_{mk}'.replace('.', '')
    rms, pk, _ = build(BASE, comp, tag)
    db = 20 * math.log10(rms / base_rms)
    rows.append((rms, ratio, thr, mk, pk, db))
    print(f'{ratio:>6} {thr:>6} {mk:>7} | {rms:.4f} {pk:.3f} {pk/max(1e-6,rms):6.2f}  {db:+.1f}dB')
rows.sort(reverse=True)
print('\nTOP5:')
for rms, ratio, thr, mk, pk, db in rows[:5]:
    print(f'  ratio={ratio} thr={thr} makeup={mk} -> rms={rms:.4f} peak={pk:.3f} {db:+.1f}dB')
