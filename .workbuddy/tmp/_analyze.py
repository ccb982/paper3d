# -*- coding: utf-8 -*-
"""按特效形态分析：先自动裁出特效区域 + 量化特征，供人工判断生命阶段。"""
import os, io, json, math
from PIL import Image, ImageDraw

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
CROP = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁切'
os.makedirs(CROP, exist_ok=True)

try:
    import numpy as np
    HAVE_NP = True
except Exception:
    HAVE_NP = False
print('numpy =', HAVE_NP)

files = sorted(f for f in os.listdir(SRC) if f.startswith('frame_') and f.endswith('.jpg'))

report = []
for f in files:
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    W, H = im.size
    a = np.asarray(im).astype(np.int16) if HAVE_NP else None
    if not HAVE_NP:
        continue
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]

    # 只在战场区域找：排除顶部 HUD、底部干员头像条、左侧海报
    y0, y1 = int(H * 0.07), int(H * 0.84)
    x0, x1 = int(W * 0.13), W
    reg = np.zeros((H, W), bool)
    reg[y0:y1, x0:x1] = True

    mx = np.maximum(np.maximum(R, G), B)
    mn = np.minimum(np.minimum(R, G), B)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    # 红色 + 高饱和（橙黄海报的 hue 偏黄，会被排除）
    redish = (R >= mx - 2) & (R > 70) & (sat > 0.42) & (G < 0.72 * R) & (B < 0.72 * R)
    m = redish & reg

    cnt = int(m.sum())
    if cnt < 50:
        report.append({'file': f, 'red_px': cnt, 'note': 'too few'})
        print(f, 'RED_PX', cnt, '(太少)')
        continue

    ys, xs = np.nonzero(m)
    # 稳健包围盒（1%~99% 分位，抗噪点）
    px0, px1 = np.percentile(xs, [1, 99])
    py0, py1 = np.percentile(ys, [1, 99])
    cx, cy = (px0 + px1) / 2, (py0 + py1) / 2
    half = max(px1 - px0, py1 - py0) / 2 * 1.22
    half = max(half, 60)

    l, t = int(max(0, cx - half)), int(max(0, cy - half))
    r, b = int(min(W, cx + half)), int(min(H, cy + half))
    crop = im.crop((l, t, r, b))
    crop.save(os.path.join(CROP, f.replace('.jpg', '_crop.png')))

    # ---- 量化特征 ----
    sub = a[t:b, l:r]
    sm = m[t:b, l:r]
    area = float(sm.mean())
    lum = sub.mean(axis=2)
    core = float(lum[sm].mean()) if sm.any() else 0.0
    # 边缘锐度：拉普拉斯能量的标准差
    g = lum.astype(np.float32)
    lap = np.abs(4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:])
    crisp = float(lap.mean())
    # 红色纯度：特效区里 R 通道占比
    rp = float((sub[:, :, 0][sm].mean()) / (sub[:, :, 1][sm].mean() + 1e-3)) if sm.any() else 0.0
    # 暗部比例（消散期整体会变暗/发褐）
    dark = float((lum < 60).mean())

    report.append({
        'file': f, 'red_px': cnt, 'crop_size': crop.size,
        'fill(占框比)': round(area, 3), 'core_lum': round(core, 1),
        'crisp': round(crisp, 1), 'R/G': round(rp, 2), 'dark': round(dark, 3),
    })
    print('%s  red=%6d  crop=%s  fill=%.3f  core=%5.1f  crisp=%5.1f  R/G=%.2f  dark=%.3f'
          % (f, cnt, crop.size, area, core, crisp, rp, dark))

with open(os.path.join(CROP, '_stats.json'), 'w', encoding='utf-8') as fp:
    json.dump(report, fp, ensure_ascii=False, indent=1)

# ---- 裁切接触表（大图，看得清形态）----
cells = [f for f in files if os.path.exists(os.path.join(CROP, f.replace('.jpg', '_crop.png')))]
if cells:
    COLS, CW = 4, 460
    CH = CW
    rows_n = (len(cells) + COLS - 1) // COLS
    sheet = Image.new('RGB', (COLS * CW, rows_n * (CH + 30)), (22, 22, 24))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(cells):
        im = Image.open(os.path.join(CROP, f.replace('.jpg', '_crop.png'))).convert('RGB')
        im.thumbnail((CW - 12, CH - 12), Image.LANCZOS)
        cxx, cyy = (i % COLS) * CW + 6, (i // COLS) * (CH + 30) + 26
        sheet.paste(im, (cxx, cyy))
        d.text((cxx, cyy - 20), f.replace('frame_', '#').replace('.jpg', ''), fill=(240, 240, 240))
    p = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁切接触表.png'
    sheet.save(p)
    print('\nSHEET ->', p, sheet.size)
