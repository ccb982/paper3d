# -*- coding: utf-8 -*-
"""收紧检测：只抓自发光高饱和红，用密度峰值锁定特效中心，再出正方形紧裁。"""
import os, json
import numpy as np
from PIL import Image, ImageDraw

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
CROP = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁切'
os.makedirs(CROP, exist_ok=True)
for f in os.listdir(CROP):
    if f.endswith('.png') and '_crop' in f:
        os.remove(os.path.join(CROP, f))

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

    strict = (R > 110) & (sat > 0.50) & ((R - np.maximum(G, B)) > 55) & reg

    if strict.sum() < 40:
        print(f, 'NONE'); rep.append({'file': f, 'ok': False}); continue

    # 密度峰值 → 锁定特效中心
    gx, gy = 28, 14
    hist, xe, ye = np.histogram2d(
        np.nonzero(strict)[1], np.nonzero(strict)[0], bins=[gx, gy])
    ix, iy = np.unravel_index(np.argmax(hist), hist.shape)
    cxs = (xe[ix] + xe[ix + 1]) / 2; cys = (ye[iy] + ye[iy + 1]) / 2
    ys, xs = np.nonzero(strict)
    d = np.hypot(xs - cxs, ys - cys)
    keep = d < W * 0.42
    if keep.sum() < 40: keep = np.ones_like(strict)[ys, xs]
    xs2, ys2 = xs[keep], ys[keep]

    px0, px1 = np.percentile(xs2, [2, 98]); py0, py1 = np.percentile(ys2, [2, 98])
    cx, cy = (px0 + px1) / 2, (py0 + py1) / 2
    half = float(max(px1 - px0, py1 - py0)) / 2 * 1.25
    half = float(np.clip(half, 120, 620))

    l, t = int(max(0, cx - half)), int(max(0, cy - half))
    r, b = int(min(W, cx + half)), int(min(H, cy + half))
    crop = im.crop((l, t, r, b))
    crop.save(os.path.join(CROP, f.replace('.jpg', '_crop.png')))

    sub = a[t:b, l:r]
    lum = sub.mean(axis=2)
    sm = strict[t:b, l:r]
    core = float(np.percentile(lum[sm], 90)) if sm.any() else 0.0
    diag = float(math.hypot(b - t, r - l)) if False else float((b - t))
    area = float(sm.mean())
    mxs = sub[:, :, 0] - np.maximum(sub[:, :, 1], sub[:, :, 2])
    red_amt = float(mxs[sm].mean()) if sm.any() else 0.0
    el = lum.astype(np.float32)
    lap = np.abs(4 * el[1:-1, 1:-1] - el[:-2, 1:-1] - el[2:, 1:-1] - el[1:-1, :-2] - el[1:-1, 2:])
    crisp = float(lap.mean())
    rep.append({'file': f, 'ok': True, 'side': b - t,
                'red_px': int(strict.sum()), 'crop_fill': round(area, 3),
                'core_lum': round(core, 1), 'red_amt': round(red_amt, 1),
                'crisp': round(crisp, 1)})
    print('%s  side=%4d  red=%6d  fill=%.3f  core=%5.1f  redAmt=%5.1f  crisp=%5.1f'
          % (f, b - t, strict.sum(), area, core, red_amt, crisp))

with open(os.path.join(CROP, '_stats.json'), 'w', encoding='utf-8') as fp:
    json.dump(rep, fp, ensure_ascii=False, indent=1)

cells = [x['file'] for x in rep if x.get('ok')]
COLS, CW = 4, 460
rows_n = (len(cells) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * CW, rows_n * (CW + 30)), (22, 22, 24))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(cells):
    im = Image.open(os.path.join(CROP, f.replace('.jpg', '_crop.png'))).convert('RGB')
    im.thumbnail((CW - 12, CW - 12), Image.LANCZOS)
    cxx, cyy = (i % COLS) * CW + 6, (i // COLS) * (CW + 30) + 26
    sheet.paste(im, (cxx, cyy))
    d.text((cxx, cyy - 20), f.replace('frame_', '#').replace('.jpg', ''), fill=(240, 240, 240))
p = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁切接触表.png'
sheet.save(p)
print('\nSHEET ->', p, sheet.size)
