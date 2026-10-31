# -*- coding: utf-8 -*-
"""分析音频 RMS 包络（0.25s 一帧），用来定位「触地撞击」在哪一刻。"""
import os, subprocess, sys, tempfile, array

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
src = os.path.join(tempfile.gettempdir(), 'ship_raw', sys.argv[1] + '.mp3')
r = subprocess.run([FF, '-i', src, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
                   capture_output=True)
pcm = r.stdout
n = len(pcm) // 2
a = array.array('h'); a.frombytes(pcm[:n * 2])
sr = 8000
win = sr // 4   # 0.25s
print(f'file={sys.argv[1]}  dur={n/sr:.2f}s  frames={n//win}')
peak = 0.0
for i in range(n // win):
    seg = a[i * win:(i + 1) * win]
    rms = (sum(float(v) * v for v in seg) / len(seg)) ** 0.5 / 32768
    peak = max(peak, rms)
    bar = '#' * int(rms * 120)
    print(f'{i*0.25:6.2f}s  {rms:.4f} {bar}')
print(f'PEAK_RMS={peak:.4f}')
