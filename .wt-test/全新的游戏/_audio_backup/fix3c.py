# -*- coding: utf-8 -*-
"""修正两处：
  1) 击中水面：上一版参照了「击打类 RMS」，但那批音效本身偏轻（击中地面 rms 仅 0.038）
     → 改用 peak 对齐（0.62，与 击中地面 0.594 / 涉水 0.554 同档）
  2) 舰船着陆：上一版只 +1.2dB。peak 已到 0.966 顶格，要靠**更强压缩**换平均响度
"""
import os, shutil, subprocess, tempfile, array, math

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
SFX = r'C:\Users\22641\Desktop\架构重置\全新的游戏\public\sfx'
TMP = os.path.join(tempfile.gettempdir(), 'ship_raw')


def run(args):
    r = subprocess.run([FF, '-y'] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('FFMPEG FAIL\n', (r.stderr or '')[-1500:]); raise SystemExit(1)


def measure(path):
    r = subprocess.run([FF, '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True)
    a = array.array('h'); a.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
    rms = (sum(float(v) * v for v in a) / max(1, len(a))) ** 0.5 / 32768
    pk = max(abs(float(v)) for v in a) / 32768 if len(a) else 0.0
    return rms, pk, len(a) / 8000


# ---------- 1) 击中水面：按 peak 0.62 对齐 ----------
cur = os.path.join(SFX, '击中水面.mp3')
r0, pk0, d0 = measure(cur)
gain = 0.62 / max(1e-6, pk0)
tmp = os.path.join(TMP, 'water2.mp3')
run(['-i', cur, '-af', f'volume={gain:.3f},alimiter=limit=0.95',
     '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', tmp])
shutil.move(tmp, cur)
r1, pk1, d1 = measure(cur)
print(f'击中水面.mp3  peak {pk0:.3f} -> {pk1:.3f}  rms {r0:.4f} -> {r1:.4f}  dur={d1:.2f}s')
print(f'              参照: 击中地面 peak=0.594 rms=0.038 | 涉水 peak=0.554 rms=0.078')

# ---------- 2) 舰船着陆：更强压缩换平均响度 ----------
raw = os.path.join(TMP, '757.mp3')
dst = os.path.join(SFX, '舰船着陆.mp3')
tmp2 = os.path.join(TMP, 'land2.mp3')
# ratio 拉到 18、threshold 压到 0.02：尖峰被削平 → 同样的峰值上限下平均能量更高
comp = 'acompressor=threshold=0.02:ratio=18:attack=1:release=260:makeup=6'
run(['-i', raw, '-af',
     f'bass=g=12:f=110:w=0.7,aecho=0.8:0.88:150|320:0.20|0.12,{comp},alimiter=limit=0.92',
     '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', tmp2])
r0, pk0, _ = measure(tmp2)
gain = 0.97 / max(1e-6, pk0)
tmp3 = os.path.join(TMP, 'land3.mp3')
run(['-i', tmp2, '-af', f'volume={gain:.3f},alimiter=limit=0.98',
     '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', tmp3])
shutil.move(tmp3, dst)
r1, pk1, d1 = measure(dst)
old_r, old_p = 0.2474, 1.44
print(f'舰船着陆.mp3  rms {old_r:.4f} -> {r1:.4f} (+{20*math.log10(r1/old_r):.1f}dB)  '
      f'peak {old_p:.2f}(削波) -> {pk1:.3f}  dur={d1:.2f}s')
