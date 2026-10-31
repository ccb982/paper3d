# -*- coding: utf-8 -*-
"""按「真实响度」选激光音：裁掉首尾静音后测 RMS（不是峰值！）。
   上一版只看了 25ms 窗峰值 + 全局峰值，选中了两个能量极弱的瞬态（RMS 0.02），
   实际听不见。这次以「裁剪后有效段 RMS」为主要指标。
"""
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


def pcm(path):
    r = subprocess.run([FF, '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], capture_output=True)
    a = array.array('h'); a.frombytes(r.stdout[:len(r.stdout) // 2 * 2])
    return a


def active_span(a, thresh=0.01):
    """去掉首尾静音，返回 (i0, i1)"""
    win = 80  # 10ms
    n = len(a) // win
    lv = []
    for i in range(n):
        seg = a[i * win:(i + 1) * win]
        lv.append((sum(float(v) * v for v in seg) / len(seg)) ** 0.5 / 32768)
    peak = max(lv) if lv else 0
    t = max(peak * 0.05, thresh * 0.3)
    i0 = next((i for i, v in enumerate(lv) if v >= t), 0)
    i1 = next((n - 1 - i for i, v in enumerate(reversed(lv)) if v >= t), n - 1)
    return i0 * win, min(len(a), (i1 + 1) * win), peak


rows = []
for sid in sys.argv[1:]:
    try:
        p = get(sid)
    except Exception as e:
        print(sid, 'ERR', e); continue
    a = pcm(p)
    if len(a) < 800:
        continue
    i0, i1, wpeak = active_span(a)
    seg = a[i0:i1]
    if len(seg) < 400:
        continue
    rms = (sum(float(v) * v for v in seg) / len(seg)) ** 0.5 / 32768
    pk = max(abs(float(v)) for v in seg) / 32768
    rows.append({
        'id': sid,
        'full': len(a) / 8000,
        'dur': len(seg) / 8000,
        'start': i0 / 8000,
        'rms': rms,
        'peak': pk,
        'crest': pk / max(1e-6, rms),
        'kb': os.path.getsize(p) / 1024,
    })

rows.sort(key=lambda r: r['rms'], reverse=True)
print(f'{"id":>6} {"全長":>6} {"有效":>6} {"起":>5} {"RMS":>7} {"peak":>6} {"crest":>6} {"KB":>7}')
print(f'{"— 参照 —":<6}')
print(f'{"击地":>6} {"0.70":>6} {"0.70":>6} {"":>5} {"0.038":>7} {"0.594":>6} {"15.6":>6}')
print(f'{"涉水":>6} {"0.70":>6} {"0.70":>6} {"":>5} {"0.078":>7} {"0.554":>6} {"7.1":>6}')
print(f'{"旧激光":>6} {"0.45":>6} {"0.45":>6} {"":>5} {"0.023":>7} {"0.617":>6} {"26.4":>6}  ← 太轻')
print()
for r in rows:
    ok = '  ★够响' if r['rms'] >= 0.09 else ''
    print(f'{r["id"]:>6} {r["full"]:6.2f} {r["dur"]:6.2f} {r["start"]:5.2f} '
          f'{r["rms"]:7.4f} {r["peak"]:6.3f} {r["crest"]:6.1f} {r["kb"]:7.1f}{ok}')
