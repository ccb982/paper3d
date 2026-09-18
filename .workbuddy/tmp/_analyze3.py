# -*- coding: utf-8 -*-
"""腐蚀法锁定特效团块（抗零散红点），出紧裁 + 形态特征。"""
import os, json
import numpy as np
from PIL import Image, ImageDraw

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
CROP = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁切'
os.makedirs(CROP, exist_ok=True)
for f in os.listdir(CROP):
    if f.endswith('.png'):
        os.remove(os.path.join(CROP, f))

DS = 8  # 降采样倍数

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

files = sorted(f for f in os.listdir(SRC) if f.startswith('frame_') and f.endswith('.jpg'))
rep = []
for f in files:
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.int16)
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = np.maximum(np.maximum(R, G), B)
    mn = np.minimum(np.minimum(R, G), B)
    sat = (mx - mn) / np.maximum(mx, 1)

    y0, y1 = int(H * 0.06), int(H * 0.85)
    x0, x1 = int(W * 0.12), W
    reg = np.zeros((H, W), bool); reg[y0:y1, x0:x1] = True

    strict = (R > 105) & (sat > 0.48) & ((R - np.maximum(G, B)) > 50) & reg

    # 降采样：块内出现红点即算 1
    hh, ww = H // DS, W // DS
    small = strict[:hh * DS, :ww * DS].reshape(hh, DS, ww, DS).any(axis=(1, 3))

    blob = None
    for k in (4, 3, 2, 1):
        e = erode(small, k)
        if e.sum() > 6:
            blob = dilate(e, k + 3)
            break
    if blob is None:
        print('%s  -> 未检出成团特效' % f)
        rep.append({'file': f, 'ok': False})
        continue

    ys, xs = np.nonzero(blob)
    px0, px1 = xs.min() * DS, (xs.max() + 1) * DS
    py0, py1 = ys.min() * DS, (ys.max() + 1) * DS
    cx, cy = (px0 + px1) / 2, (py0 + py1) / 2
    side = int(max(px1 - px0, py1 - py0) * 1.30)
    side = int(np.clip(side, 160, 900))
    l, t = int(max(0, cx - side / 2)), int(max(0, cy - side / 2))
    r, b = int(min(W, l + side)), int(min(H, t + side))

    crop = im.crop((l, t, r, b))
    crop.save(os.path.join(CROP, f.replace('.jpg', '_crop.png')))

    sub = a[t:b, l:r]; lum = sub.mean(axis=2).astype(np.float32)
    sm = strict[t:b, l:r]
    npx = int(sm.sum())
    core = float(np.percentile(lum[sm], 92)) if npx else 0.0
    fill = float(sm.mean())
    lap = np.abs(4 * lum[1:-1, 1:-1] - lum[:-2, 1:-1] - lum[2:, 1:-1]
                 - lum[1:-1, :-2] - lum[1:-1, 2:])
    crisp = float(lap.mean())
    rep.append({'file': f, 'ok': True, 'side': int(r - l), 'blob_w': int(px1 - px0),
                'blob_h': int(py1 - py0), 'red_px': int(npx), 'fill': round(fill, 3),
                'core': round(core, 1), 'crisp': round(crisp, 1)})
    print('%s  crop=%4d  blob=%4dx%-4d  red=%6d  fill=%.3f  core=%5.1f  crisp=%5.1f'
          % (f, r - l, px1 - px0, py1 - py0, npx, fill, core, crisp))

with open(os.path.join(CROP, '_stats.json'), 'w', encoding='utf-8') as fp:
    json.dump(rep, fp, ensure_ascii=False, indent=1)

cells = [x['file'] for x in rep
         if x.get('ok') and x['blob_w'] > 140 and x['blob_h'] > 140]
print('\n候选特效帧：', len(cells))
COLS, CW = 3, 560
rows_n = (len(cells) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * CW, rows_n * (CW + 32)), (20, 20, 22))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(cells):
    im = Image.open(os.path.join(CROP, f.replace('.jpg', '_crop.png'))).convert('RGB')
    im.thumbnail((CW - 14, CW - 14), Image.LANCZOS)
    cxx, cyy = (i % COLS) * CW + 7, (i // COLS) * (CW + 32) + 28
    sheet.paste(im, (cxx, cyy))
    st = next(x for x in rep if x['file'] == f)
    d.text((cxx, cyy - 22), '%s  blob %dx%d  red %d' % (
        f.replace('frame_', '#').replace('.jpg', ''), st['blob_w'], st['blob_h'], st['red_px']),
        fill=(240, 240, 240))
p = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_候选接触表.png'
sheet.save(p)
print('SHEET ->', p, sheet.size)

