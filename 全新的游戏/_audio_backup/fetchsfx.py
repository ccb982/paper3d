# -*- coding: utf-8 -*-
"""下载 Mixkit 候选音效并打印时长（用来反推页面上的名称）。"""
import os, sys, subprocess, urllib.request, tempfile

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'}
OUT = os.path.join(tempfile.gettempdir(), 'ship_raw')
os.makedirs(OUT, exist_ok=True)


def dur(path):
    r = subprocess.run([FF, '-i', path], capture_output=True, text=True, encoding='utf-8', errors='replace')
    for line in (r.stderr or '').splitlines():
        if 'Duration:' in line:
            return line.split('Duration:')[1].split(',')[0].strip()
    return '?'


ids = sys.argv[1:]
for sid in ids:
    url = f'https://assets.mixkit.co/active_storage/sfx/{sid}/{sid}-preview.mp3'
    dst = os.path.join(OUT, f'{sid}.mp3')
    if not os.path.exists(dst):
        try:
            req = urllib.request.Request(url, headers=UA)
            data = urllib.request.urlopen(req, timeout=60).read()
            open(dst, 'wb').write(data)
        except Exception as e:
            print(sid, 'ERR', e)
            continue
    print(f'{sid:>6}  {dur(dst)}  {os.path.getsize(dst)/1024:7.1f} KB')
