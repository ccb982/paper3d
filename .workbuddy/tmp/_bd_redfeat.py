# -*- coding: utf-8 -*-
"""用「红度」给出全部 16 帧的紧凑量化：能量、半径、尖刺数、颜色。"""
import os, json
import numpy as np, cv2
from PIL import Image

BASE = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
BOX = (1117, 138, 2347, 1033)
files = sorted([f for f in os.listdir(BASE) if f.endswith('.jpg')], key=lambda s: int(s[:2]))


def theta_profile(red, cx, cy, r):
    h, w = red.shape
    n = 720
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    xs = np.clip((cx + r * np.cos(th)).astype(int), 0, w - 1)
    ys = np.clip((cy + r * np.sin(th)).astype(int), 0, h - 1)
    return red[ys, xs]


def count_peaks(p, frac=0.35):
    m = p.max()
    if m < 25:
        return 0, 0.0
    q = p > frac * m
    # 环形连通段数
    d = np.diff(np.r_[q.astype(int), q[0]])
    seg = int((d == 1).sum())
    return seg, float(m)


rows = []
for i, fn in enumerate(files, start=1):
    with Image.open(os.path.join(BASE, fn)) as im:
        rgb = np.asarray(im.convert('RGB').crop(BOX)).astype(np.float32)
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    red = np.maximum(R - np.maximum(G, B), 0)
    m = red > 70
    r = {'seq': i, 'red_max': float(red.max()), 'pct60': round(100 * (red > 60).mean(), 2),
         'pct150': round(100 * (red > 150).mean(), 3), 'mask_pct': round(100 * m.mean(), 3)}
    if m.sum() > 100:
        ys, xs = np.nonzero(m)
        cx, cy = float(xs.mean()), float(ys.mean())
        d = np.hypot(xs - cx, ys - cy)
        r95 = float(np.percentile(d, 95))
        r.update({'cx': round(cx / rgb.shape[1], 3), 'cy': round(cy / rgb.shape[0], 3),
                  'r95n': round(r95 / rgb.shape[0], 3), 'r95px': round(r95, 1),
                  'rmaxn': round(float(d.max()) / rgb.shape[0], 3)})
        # 径向红度轮廓（12 桶, r/r95）
        yy, xx = np.mgrid[0:red.shape[0], 0:red.shape[1]]
        rr = np.hypot(xx - cx, yy - cy) / max(r95, 1e-6)
        prof, _ = np.histogram(rr, 12, (0, 1.5), weights=red)
        cnt, _ = np.histogram(rr, 12, (0, 1.5))
        r['radial'] = (prof / np.maximum(cnt, 1)).round(1).tolist()
        # 尖刺数（两个半径各测一次）
        sp = []
        for fr in (0.55, 0.85):
            p = theta_profile(red, cx, cy, fr * r95)
            seg, mx = count_peaks(p)
            sp.append(seg)
        r['spikes_c55'] = sp[0]
        r['spikes_c85'] = sp[1]
        # 连通域
        n, lab, st, ce = cv2.connectedComponentsWithStats((m * 255).astype(np.uint8), 8, cv2.CV_32S)
        if n > 1:
            areas = np.sort(st[1:, cv2.CC_STAT_AREA])[::-1]
            big = areas[areas > 0.03 * m.sum()]
            r['cc_n'] = int(len(big))
            r['cc_top_pct'] = round(100.0 * areas[0] / m.sum(), 1)
        # 颜色
        hot = red > 150
        if hot.sum() > 30:
            r['hot_rgb'] = [int(rgb[..., c][hot].mean()) for c in range(3)]
        mid = (red > 70) & (red <= 150)
        if mid.sum() > 30:
            r['mid_rgb'] = [int(rgb[..., c][mid].mean()) for c in range(3)]
    rows.append(r)

hdr = ('seq', 'red_max', 'pct60', 'pct150', 'mask%', 'cx', 'cy', 'r95n', 'rmaxn', 's55', 's85', 'cc', 'hot_rgb')
print('%3s %7s %6s %7s %6s %6s %6s %6s %6s %4s %4s %4s  %s' % hdr)
for r in rows:
    print('%3d %7.0f %6.2f %7.3f %6.3f %6s %6s %6s %6s %4s %4s %4s  %s / %s' % (
        r['seq'], r['red_max'], r['pct60'], r['pct150'], r['mask_pct'],
        r.get('cx', '-'), r.get('cy', '-'), r.get('r95n', '-'), r.get('rmaxn', '-'),
        r.get('spikes_c55', '-'), r.get('spikes_c85', '-'), r.get('cc_n', '-'),
        r.get('hot_rgb', '-'), r.get('mid_rgb', '-')))

print('\n=== 径向红度轮廓（12 桶, r/r95 = 0.06→1.44；1.0 处为 r95）===')
for r in rows:
    if 'radial' in r:
        print('  #%-3d %s' % (r['seq'], r['radial']))

json.dump(rows, open(os.path.join(BASE, '红度特征.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
