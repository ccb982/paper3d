# -*- coding: utf-8 -*-
"""用画面里的橙色伤害飘字当"时钟"：数字上浮高度 ≈ 特效已经播放了多久。"""
import os, json
import numpy as np
from PIL import Image, ImageDraw

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
files = sorted(f for f in os.listdir(SRC) if f.startswith('frame_') and f.endswith('.jpg'))

DS = 8
def erode(m, k):
    for _ in range(k):
        e = m.copy()
        e[1:, :] &= m[:-1, :]; e[:-1, :] &= m[1:, :]
        e[:, 1:] &= m[:, :-1]; e[:, :-1] &= m[:, 1:]
        m = e
    return m
def dilate(m, k):
    for _ in range(k):
        d = m.copy()
        d[1:, :] |= m[:-1, :]; d[:-1, :] |= m[1:, :]
        d[:, 1:] |= m[:, :-1]; d[:, :-1] |= m[:, 1:]
        m = d
    return m

out = []
for f in files:
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.int16)
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = np.maximum(np.maximum(R, G), B); mn = np.minimum(np.minimum(R, G), B)
    sat = (mx - mn) / np.maximum(mx, 1)

    y0, y1 = int(H * 0.06), int(H * 0.85)
    x0, x1 = int(W * 0.12), W
    reg = np.zeros((H, W), bool); reg[y0:y1, x0:x1] = True

    # --- 特效团块中心 ---
    strict = (R > 105) & (sat > 0.48) & ((R - np.maximum(G, B)) > 50) & reg
    hh, ww = H // DS, W // DS
    small = strict[:hh * DS, :ww * DS].reshape(hh, DS, ww, DS).any(axis=(1, 3))
    blob = None
    for k in (4, 3, 2, 1):
        e = erode(small, k)
        if e.sum() > 6:
            blob = dilate(e, k + 3); break
    if blob is None:
        out.append({'file': f, 'burst': False}); continue
    ys, xs = np.nonzero(blob)
    bx0, bx1 = xs.min() * DS, (xs.max() + 1) * DS
    by0, by1 = ys.min() * DS, (ys.max() + 1) * DS
    ecx, ecy = (bx0 + bx1) / 2, (by0 + by1) / 2
    bw, bh = bx1 - bx0, by1 - by0

    # --- 橙色伤害飘字（R 高 / G 中 / B 低，且偏黄）---
    orange = (R > 195) & (G > 95) & (G < 205) & (B < 125) & ((R - G) > 40) & ((G - B) > 30) & reg
    oy, ox = np.nonzero(orange)
    near = np.abs(ox - ecx) < 760
    oy, ox = oy[near], ox[near]
    npix = int(len(oy))
    if npix >= 30:
        ocy = float(np.percentile(oy, 50))
        otop = float(np.percentile(oy, 8))
        rise = ecy - ocy      # 正值 = 飘字在爆点上方
        rise_top = ecy - otop
    else:
        ocy = otop = rise = rise_top = float('nan')

    out.append({'file': f, 'burst': True, 'bw': int(bw), 'bh': int(bh),
                'ecx': int(ecx), 'ecy': int(ecy), 'o_px': npix,
                'rise': None if npix < 30 else round(rise, 1),
                'rise_top': None if npix < 30 else round(rise_top, 1)})

print('%-12s %5s %5s  %8s %8s   %s' % ('frame', 'bw', 'bh', 'rise', 'riseTop', 'orange_px'))
for r in out:
    if not r.get('burst'):
        print('%-12s  -- 无爆点团块' % r['file']); continue
    print('%-12s %5d %5d  %8s %8s   %d' % (
        r['file'].replace('.jpg', ''), r['bw'], r['bh'],
        r.get('rise'), r.get('rise_top'), r['o_px']))

with open(r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁切\_clock.json', 'w', encoding='utf-8') as fp:
    json.dump(out, fp, ensure_ascii=False, indent=1)
