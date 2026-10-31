# -*- coding: utf-8 -*-
"""重做三件事（loudnorm 对短素材不可靠，改用「测 RMS → 算增益 → 压缩+硬限幅」）。

  参照系：先量出现有同类音效的 RMS，新素材按同一量级对齐。
"""
import os, shutil, subprocess, tempfile, array

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
ROOT = r'C:\Users\22641\Desktop\架构重置\全新的游戏'
SFX = os.path.join(ROOT, 'public', 'sfx')
MUS = os.path.join(ROOT, 'public', 'music')
BK = os.path.join(ROOT, '_audio_backup')
TMP = os.path.join(tempfile.gettempdir(), 'ship_raw')
os.makedirs(BK, exist_ok=True); os.makedirs(TMP, exist_ok=True)


def run(args):
    r = subprocess.run([FF, '-y'] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('FFMPEG FAIL\n', (r.stderr or '')[-1500:]); raise SystemExit(1)


def pcm(path):
    r = subprocess.run([FF, '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True)
    a = array.array('h'); a.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
    return a


def rms_of(a):
    return (sum(float(v) * v for v in a) / max(1, len(a))) ** 0.5 / 32768


def peak_of(a):
    return max(abs(float(v)) for v in a) / 32768 if len(a) else 0.0


def measure(path):
    a = pcm(path)
    return rms_of(a), peak_of(a), len(a) / 8000


def backup(path, name):
    dst = os.path.join(BK, name)
    if not os.path.exists(dst):
        shutil.copy2(path, dst)


def rebuild(src, af, dst, extra=None):
    """经临时文件中转（ffmpeg 不能原地写）"""
    tmp = os.path.join(TMP, 'out.mp3')
    run(['-i', src, '-af', af] + (extra or []) + ['-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', tmp])
    shutil.move(tmp, dst)


print('=== 参照：现有同类音效 RMS / peak ===')
refs = {}
for n in ['击中地面.mp3', '击中地面2.mp3', '击草.mp3', '脚步草.mp3', '涉水.mp3', '入水.mp3']:
    p = os.path.join(SFX, n)
    r, pk, d = measure(p)
    refs[n] = r
    print(f'  {n:<16} rms={r:.4f} peak={pk:.3f} dur={d:.2f}s')
target_hit = sum(refs[k] for k in ['击中地面.mp3', '击中地面2.mp3']) / 2
print(f'  >>> 击打类目标 RMS = {target_hit:.4f}\n')

# ---------- 1) 击中水面：裁入水瞬态 → 提速 → 提频 → 对齐击打类 RMS ----------
src = os.path.join(SFX, '入水.mp3')
dst = os.path.join(SFX, '击中水面.mp3')
tmp1 = os.path.join(TMP, 'water1.mp3')
run(['-i', src, '-af',
     'atrim=0.30:0.68,asetpts=N/SR/TB,atempo=1.25,treble=g=5:f=3200,'
     'afade=t=out:st=0.22:d=0.08,volume=1.15',
     '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', tmp1])
r0, _, _ = measure(tmp1)
gain = min(8.0, target_hit / max(1e-6, r0))
rebuild(tmp1, f'volume={gain:.3f},alimiter=limit=0.95', dst)
r1, pk1, d1 = measure(dst)
print(f'击中水面.mp3  rms {r0:.4f} -> {r1:.4f} (gain {gain:.2f}x)  peak={pk1:.3f} dur={d1:.2f}s')

# ---------- 2) 舰船着陆：压缩提平均 + 修掉削波（改前 peak +3.2dBFS） ----------
src = os.path.join(SFX, '舰船着陆.mp3')
backup(src, '舰船着陆.v1(削波版).mp3')
raw = os.path.join(TMP, '757.mp3')
tmp2 = os.path.join(TMP, 'land1.mp3')
# acompressor 压掉尖峰 → 换取更高的平均响度且不削波
run(['-i', raw, '-af',
     'bass=g=12:f=110:w=0.7,'
     'aecho=0.8:0.88:150|320:0.20|0.12,'
     'acompressor=threshold=0.05:ratio=10:attack=2:release=180:makeup=4,'
     'alimiter=limit=0.92',
     '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', tmp2])
r0, pk0, _ = measure(tmp2)
# 目标：RMS 0.40（改前 0.2474，约 +4.2dB），同时峰值不许超过 0.98
gain = min(8.0, 0.40 / max(1e-6, r0))
rebuild(tmp2, f'volume={gain:.3f},alimiter=limit=0.98', src, ['-ac', '1'])
r1, pk1, d1 = measure(src)
print(f'舰船着陆.mp3  rms {r0:.4f} -> {r1:.4f} (gain {gain:.2f}x)  peak={pk1:.3f} dur={d1:.2f}s'
      f'   [改前 rms=0.2474 peak=1.44(削波)]')

# ---------- 3) 哈吉马路由：6.38s 够长，直接按峰值余量提 ----------
src = os.path.join(MUS, '哈吉马路由.mp3')
backup(src, '哈吉马路由.原版.mp3')
r0, pk0, _ = measure(src)
gain = min(12.0, 0.95 / max(1e-6, pk0))     # 把峰值顶到 0.95（-0.4dBFS）
tmp3 = os.path.join(TMP, 'hajima.mp3')
run(['-i', src, '-af', f'volume={gain:.3f},alimiter=limit=0.97',
     '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', tmp3])
shutil.move(tmp3, src)
r1, pk1, d1 = measure(src)
print(f'哈吉马路由.mp3 rms {r0:.4f} -> {r1:.4f} (gain {gain:.2f}x = {20*__import__("math").log10(gain):.1f}dB) '
      f'peak={pk1:.3f} dur={d1:.2f}s')
