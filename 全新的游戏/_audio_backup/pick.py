# -*- coding: utf-8 -*-
"""批量下载 Mixkit 候选并打分：找「重物落地」型音效（短、瞬态在前、尾部衰减）。"""
import os, subprocess, sys, tempfile, array, urllib.request

FF = r'C:\Users\22641\.workbuddy\binaries\python\envs\default\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'}
RAW = os.path.join(tempfile.gettempdir(), 'ship_raw')
os.makedirs(RAW, exist_ok=True)


def get(sid):
    dst = os.path.join(RAW, f'{sid}.mp3')
    if not os.path.exists(dst):
        url = f'https://assets.mixkit.co/active_storage/sfx/{sid}/{sid}-preview.mp3'
        open(dst, 'wb').write(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
    return dst


def analyze(sid):
    p = get(sid)
    r = subprocess.run([FF, '-i', p, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True)
    a = array.array('h'); a.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
    sr = 8000; n = len(a)
    if n < sr * 0.05:
        return None
    win = sr // 40  # 25ms
    frames = [0.0] * (n // win)
    for i in range(len(frames)):
        seg = a[i * win:(i + 1) * win]
        frames[i] = (sum(float(v) * v for v in seg) / len(seg)) ** 0.5 / 32768
    peak = max(frames); pi = frames.index(peak)
    dur = n / sr
    tail = sum(frames[-max(1, len(frames) // 10):]) / max(1, len(frames) // 10)
    return {
        'id': sid, 'dur': dur, 'peak': peak,
        'peakAt': pi * 0.025,
        'peakFrac': pi / max(1, len(frames)),
        'tailRatio': tail / peak if peak else 0,
        'kb': os.path.getsize(p) / 1024,
    }


rows = []
for sid in sys.argv[1:]:
    try:
        d = analyze(sid)
    except Exception as e:
        print(sid, 'ERR', e); continue
    if not d:
        continue
    rows.append(d)

# 打分：瞬态在前 20%、时长 0.4~4s、尾部明显衰减、峰值够大
def score(d):
    s = 0.0
    s += 3.0 if d['peakFrac'] < 0.20 else (1.0 if d['peakFrac'] < 0.40 else 0.0)
    s += 2.0 if 0.4 <= d['dur'] <= 4.0 else 0.0
    s += 2.0 * (1.0 - min(1.0, d['tailRatio']))
    s += 1.5 * min(1.0, d['peak'] / 0.25)
    return s

rows.sort(key=score, reverse=True)
print(f'{"id":>6} {"dur":>6} {"peak":>6} {"peakAt":>7} {"peakFrac":>8} {"tail%":>6} {"KB":>7}  score')
for d in rows:
    print(f'{d["id"]:>6} {d["dur"]:6.2f} {d["peak"]:6.3f} {d["peakAt"]:7.2f} '
          f'{d["peakFrac"]:8.2f} {d["tailRatio"]*100:6.1f} {d["kb"]:7.1f}  {score(d):.2f}')
