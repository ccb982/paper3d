# -*- coding: utf-8 -*-
"""生成两个新音效：
  public/sfx/飞行引擎.mp3  —— 舰船航行期循环引擎轰鸣（无缝 loop）
  public/sfx/舰船着陆.mp3  —— 舰船触地重击（低频增强 + 轻微余韵）
"""
import os, subprocess, tempfile

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
RAW = os.path.join(tempfile.gettempdir(), 'ship_raw')
OUT = r'C:\Users\22641\Desktop\架构重置\全新的游戏\public\sfx'
os.makedirs(OUT, exist_ok=True)


def run(args):
    r = subprocess.run([FF, '-y'] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('FFMPEG FAIL\n', (r.stderr or '')[-1200:])
        raise SystemExit(1)
    return r


# ---------- 1) 飞行引擎：1590「运输机飞行轰鸣」裁 20~30s 做无缝循环 ----------
# 为什么取 20~30s：整段包络是"由远及近再到远去"，20~30s 正好在轰鸣最稳的平台区。
engine_src = os.path.join(RAW, '1590.mp3')
engine_out = os.path.join(OUT, '飞行引擎.mp3')
run(['-i', engine_src,
     '-filter_complex',
     '[0:a]atrim=20:30,asetpts=N/SR/TB[m];'
     '[0:a]atrim=28.5:30,asetpts=N/SR/TB,afade=t=out:st=0:d=1.5[t];'
     '[m][t]amix=inputs=2:duration=first:normalize=0,'
     'volume=0.45,afade=t=in:st=0:d=0.05[o]',
     '-map', '[o]', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '48k', engine_out])
print('飞行引擎.mp3', round(os.path.getsize(engine_out) / 1024, 1), 'KB')

# ---------- 2) 舰船着陆：757 重击 + 低频增强 + 轻微余韵 ----------
land_src = os.path.join(RAW, '757.mp3')
land_out = os.path.join(OUT, '舰船着陆.mp3')
run(['-i', land_src,
     '-af', 'bass=g=11:f=120:w=0.6,'
            'aecho=0.8:0.88:150|320:0.20|0.12,'
            'volume=1.35,'
            'alimiter=limit=0.95',
     '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', land_out])
print('舰船着陆.mp3', round(os.path.getsize(land_out) / 1024, 1), 'KB')
