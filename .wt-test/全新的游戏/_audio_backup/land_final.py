# -*- coding: utf-8 -*-
"""舰船着陆最终版：扫描出的最优压缩点 (ratio=6, threshold=0.12, makeup=8)，
   压缩后把峰值归一回 0.95，避免 mp3 编码 intersample 削波。
"""
import os, shutil, subprocess, tempfile, array, math

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
TMP = os.path.join(tempfile.gettempdir(), 'ship_raw')
SFX = r'C:\Users\22641\Desktop\架构重置\全新的游戏\public\sfx'
DST = os.path.join(SFX, '舰船着陆.mp3')
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
    return rms, pk, len(a) / 8000


AF = ('bass=g=12:f=110:w=0.7,'
      'aecho=0.8:0.88:150|320:0.20|0.12,'
      'acompressor=threshold=0.12:ratio=6:attack=2:release=200:makeup=8')
p1 = os.path.join(TMP, 'land_f1.mp3')
run(['-i', RAW, '-af', AF, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', p1])
r0, pk0, _ = measure(p1)
gain = 0.95 / max(1e-6, pk0)
p2 = os.path.join(TMP, 'land_f2.mp3')
run(['-i', p1, '-af', f'volume={gain:.4f}', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', p2])
shutil.move(p2, DST)
r1, pk1, d1 = measure(DST)
old = 0.2474
print(f'舰船着陆.mp3  rms {old:.4f} -> {r1:.4f}  ({20*math.log10(r1/old):+.1f}dB)'
      f'   peak={pk1:.3f}  dur={d1:.2f}s  size={os.path.getsize(DST)/1024:.1f}KB')
