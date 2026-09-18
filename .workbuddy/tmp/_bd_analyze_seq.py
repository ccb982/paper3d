# -*- coding: utf-8 -*-
"""对按序帧做量化：红爆区几何 / 能量 / 核心，输出时间轴 + 接触表 + 缩略图。"""
import os, json
import numpy as np
from PIL import Image

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
THUMB = os.path.join(SRC, 'thumbs')
os.makedirs(THUMB, exist_ok=True)

files = sorted([f for f in os.listdir(SRC) if f.endswith('.jpg')], key=lambda s: int(s[:2]))
rows = []

def analyze(path):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    s = 1100.0 / W
    im = im.resize((int(W * s), int(H * s)), Image.BILINEAR)
    a = np.asarray(im).astype(np.float32)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    warm = R - np.maximum(G, B)                 # 红/橙 超出 绿蓝 的量
    red = (warm > 38) & (R > 70)                # 红爆区
    hot = (R > 228) & (G > 168) & (B > 140) & (warm > 30)   # 白热核心
    n = red.sum()
    h, w = red.shape
    out = {'red_px': int(n), 'red_pct': float(100.0 * n / red.size),
           'energy': float(warm[red].sum() / 1e4) if n else 0.0}
    if n > 40:
        ys, xs = np.nonzero(red)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        cx, cy = xs.mean(), ys.mean()
        d = np.hypot(xs - cx, ys - cy)
        out.update({
            'bbox_w': float((x1 - x0) / w), 'bbox_h': float((y1 - y0) / h),
            'cx': float(cx / w), 'cy': float(cy / h),
            'r50': float(np.percentile(d, 50) / h), 'r95': float(np.percentile(d, 95) / h),
            'rmax': float(d.max() / h),
            'elong': float((x1 - x0) / max(1, (y1 - y0))),
            'fill': float(n / max(1, (x1 - x0 + 1) * (y1 - y0 + 1))),
        })
    out['hot_px'] = int(hot.sum())
    out['hot_pct'] = float(100.0 * hot.sum() / hot.size)
    if hot.sum() > 10:
        ys, xs = np.nonzero(hot)
        out['hot_r95'] = float(np.percentile(np.hypot(xs - xs.mean(), ys - ys.mean()), 95) / h)
    return out

for i, f in enumerate(files, start=1):
    r = analyze(os.path.join(SRC, f))
    r['seq'] = i
    rows.append(r)
    # 缩略图（给预览页做对比条）
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    im.thumbnail((360, 360), Image.LANCZOS)
    im.save(os.path.join(THUMB, '%02d.jpg' % i), quality=78, optimize=True)

keys = ['seq', 'red_pct', 'energy', 'bbox_w', 'bbox_h', 'elong', 'r50', 'r95', 'rmax', 'fill', 'hot_pct', 'hot_r95']
print(' | '.join(k[:7].rjust(7) for k in keys))
for r in rows:
    print(' | '.join(('%.4g' % r[k]).rjust(7) if k in r else '   -   ' for k in keys))

json.dump(rows, open(os.path.join(SRC, '时间轴量化.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\n缩略图:', len(os.listdir(THUMB)), '张 ->', THUMB)
