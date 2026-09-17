# -*- coding: utf-8 -*-
"""三件事：
  1) 新增「击中水面.mp3」—— 从现有 入水.mp3 裁出入水瞬态，提速+提高频 = 短促清脆的水花
  2) 舰船着陆.mp3 更响 —— 当前 peak 已 +3.2dBFS（削波），先压缩再 loudnorm，修掉失真同时提响度
  3) 哈吉马路由.mp3 更响 —— 当前 peak 只有 -12.7dBFS，整体提 ~11dB
"""
import os, shutil, subprocess

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
ROOT = r'C:\Users\22641\Desktop\架构重置\全新的游戏'
PUB = os.path.join(ROOT, 'public')
SFX = os.path.join(PUB, 'sfx')
MUS = os.path.join(PUB, 'music')
BK = os.path.join(ROOT, '_audio_backup')
os.makedirs(BK, exist_ok=True)


def run(args):
    r = subprocess.run([FF, '-y'] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('FFMPEG FAIL\n', (r.stderr or '')[-1500:]); raise SystemExit(1)


def backup(path, name):
    dst = os.path.join(BK, name)
    if not os.path.exists(dst):
        shutil.copy2(path, dst)
    return dst


def probe(path):
    r = subprocess.run([FF, '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    lu = pk = '?'
    for line in (r.stderr or '').splitlines():
        if 'I:' in line and 'LUFS' in line:
            lu = line.split('I:')[1].split('LUFS')[0].strip()
        if 'Peak:' in line and 'dBFS' in line:
            pk = line.split('Peak:')[1].split('dBFS')[0].strip()
    return lu, pk, round(os.path.getsize(path) / 1024, 1)


# ---------- 1) 击中水面 ----------
src = os.path.join(SFX, '入水.mp3')
out = os.path.join(SFX, '击中水面.mp3')
# 瞬态在 0.30~0.34s（包络峰值 0.53），裁 0.30~0.68 拿到"入水那一下 + 短回落"
run(['-i', src,
     '-af', 'atrim=0.30:0.68,asetpts=N/SR/TB,'
            'atempo=1.25,'                       # 提速 → 更短促（子弹比人快）
            'treble=g=5:f=3200,'                 # 提高频 → 清脆，和"人扑通入水"区分开
            'afade=t=out:st=0.22:d=0.08,'        # 尾端收干净，不留拖尾
            'volume=1.15,'
            'loudnorm=I=-13:TP=-1.5:LRA=6',
     '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', out])
print('击中水面.mp3 ', probe(out))

# ---------- 2) 舰船着陆：更响 + 修掉削波 ----------
src = os.path.join(SFX, '舰船着陆.mp3')
backup(src, '舰船着陆.v1(削波版).mp3')
raw = os.path.join(tempfile_get := __import__('tempfile').gettempdir(), 'ship_raw', '757.mp3')
run(['-i', raw,
     '-af', 'bass=g=12:f=110:w=0.7,'                             # 低频更足（巨物感）
            'aecho=0.8:0.88:150|320:0.20|0.12,'                  # 余韵
            'acompressor=threshold=0.06:ratio=9:attack=3:release=160:makeup=3,'
            'loudnorm=I=-7:TP=-1.0:LRA=5',                       # ★ 目标 -7 LUFS，峰值封在 -1dB
     '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', src])
print('舰船着陆.mp3 ', probe(src), ' (改前: -10.6 LUFS / +3.2 dBFS)')

# ---------- 3) 哈吉马路由：整体提 11dB ----------
src = os.path.join(MUS, '哈吉马路由.mp3')
backup(src, '哈吉马路由.原版.mp3')
run(['-i', src,
     '-af', 'volume=11dB,alimiter=limit=0.97',
     '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', src])
print('哈吉马路由.mp3', probe(src), ' (改前: -23.3 LUFS / -12.7 dBFS)')
