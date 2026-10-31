# -*- coding: utf-8 -*-
"""测素材响度（peak / RMS / EBU R128 综合响度），并打印水音的包络用于裁瞬态。"""
import os, subprocess, sys, array

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
BASE = r'C:\Users\22641\Desktop\架构重置\全新的游戏\public'


def stats(path):
    r = subprocess.run([FF, '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    err = r.stderr or ''
    out = {}
    for line in err.splitlines():
        if 'I:' in line and 'LUFS' in line:
            out['LUFS'] = line.split('I:')[1].split('LUFS')[0].strip()
        if 'Peak:' in line and 'dBFS' in line:
            out['peak'] = line.split('Peak:')[1].split('dBFS')[0].strip()
    r2 = subprocess.run([FF, '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True)
    a = array.array('h'); a.frombytes(r2.stdout[:len(r2.stdout) // 2 * 2])
    rms = (sum(float(v) * v for v in a) / max(1, len(a))) ** 0.5 / 32768
    out['rms'] = f'{rms:.4f}'
    out['dur'] = f'{len(a)/8000:.2f}s'
    return out


def envelope(path, hop=0.02):
    r = subprocess.run([FF, '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True)
    a = array.array('h'); a.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
    win = int(8000 * hop)
    n = len(a) // win
    fr = []
    for i in range(n):
        seg = a[i * win:(i + 1) * win]
        fr.append((sum(float(v) * v for v in seg) / len(seg)) ** 0.5 / 32768)
    return fr, hop


for rel in sys.argv[1:]:
    p = rel if os.path.isabs(rel) else os.path.join(BASE, rel)
    print(rel, stats(p))

env, hop = envelope(os.path.join(BASE, 'sfx', '入水.mp3'))
print('\n入水.mp3 envelope (hop=20ms):')
top = max(range(len(env)), key=lambda i: env[i])
for i, v in enumerate(env):
    print(f'  {i*hop:5.2f}s {v:.4f} {"#"*int(v*100)}{"  <== PEAK" if i==top else ""}')
