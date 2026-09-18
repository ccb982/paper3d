# -*- coding: utf-8 -*-
"""双时钟标定：① 冲击环半径（单调扩大） ② 爆点附近橙色飘字的上浮高度"""
import os, json, math
import numpy as np
from PIL import Image

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

rows = []
for f in files:
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.int16)
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = np.maximum(np.maximum(R, G), B); mn = np.minimum(np.minimum(R, G), B)
    sat = (mx - mn) / np.maximum(mx, 1)
    y0, y1 = int(H * 0.06), int(H * 0.85); x0, x1 = int(W * 0.12), W
    reg = np.zeros((H, W), bool); reg[y0:y1, x0:x1] = True

    strict = (R > 105) & (sat > 0.48) & ((R - np.maximum(G, B)) > 50) & reg
    hh, ww = H // DS, W // DS
    small = strict[:hh * DS, :ww * DS].reshape(hh, DS, ww, DS).any(axis=(1, 3))
    blob = None
    for k in (4, 3, 2, 1):
        e = erode(small, k)
        if e.sum() > 6: blob = dilate(e, k + 3); break
    if blob is None:
        rows.append({'file': f, 'burst': False}); print('%-14s 无爆点' % f); continue
    ys, xs = np.nonzero(blob)
    bx0, bx1, by0, by1 = xs.min() * DS, (xs.max() + 1) * DS, ys.min() * DS, (ys.max() + 1) * DS
    ecx, ecy = (bx0 + bx1) / 2, (by0 + by1) / 2
    bw, bh = bx1 - bx0, by1 - by0

    redness = (R - np.maximum(G, B)).astype(np.float32)
    redness[~reg] = 0

    # ---- 时钟①：径向红色能量剖面 → 环半径 ----
    step, RMAX = 12, 700
    prof = []
    rs = list(range(0, RMAX, step))
    yy, xx = np.mgrid[0:H, 0:W]
    dd = np.hypot(xx - ecx, yy - ecy)
    for rr in rs:
        m = (dd >= rr) & (dd < rr + step)
        prof.append(float(redness[m].mean()) if m.any() else 0.0)
    prof = np.asarray(prof)
    sm = np.convolve(prof, np.ones(3) / 3, mode='same')
    # 在 r >= 60px 之后找最大值（避开核心）
    idx = int(np.argmax(sm[5:]) + 5) if len(sm) > 5 else 0
    ringR = rs[idx] + step / 2
    ringVal = float(sm[idx])

    # ---- 时钟②：爆点附近橙色飘字 ----
    win = np.zeros((H, W), bool)
    win[max(0, int(ecy - 620)):int(ecy + 90), max(0, int(ecx - 430)):int(ecx + 430)] = True
    orange = (R > 195) & (G > 95) & (G < 205) & (B < 125) & ((R - G) > 40) & ((G - B) > 30) & win
    oy, ox = np.nonzero(orange)
    npix = len(oy)
    rise = round(ecy - float(np.median(oy)), 1) if npix >= 60 else None

    rows.append({'file': f, 'burst': True, 'bw': int(bw), 'bh': int(bh),
                 'ecx': int(ecx), 'ecy': int(ecy), 'ringR': round(ringR, 1),
                 'ringVal': round(ringVal, 1), 'o_px': int(npix), 'rise': rise})
    print('%-14s blob=%4dx%-4d ringR=%5.1f (val %5.1f)  o_px=%4d rise=%s'
          % (f.replace('.jpg', ''), bw, bh, ringR, ringVal, npix, rise))

with open(r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁切\_clock.json', 'w', encoding='utf-8') as fp:
    json.dump(rows, fp, ensure_ascii=False, indent=1)
