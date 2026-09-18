# -*- coding: utf-8 -*-
"""v3：先跨帧求交集得到「静态 UI 元素」并剔除，再量化爆点。"""
import os, json
import numpy as np, cv2
from PIL import Image

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
files = sorted([f for f in os.listdir(SRC) if f.endswith('.jpg')], key=lambda s: int(s[:2]))

imgs, masks = [], []
for f in files:
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    W, H = im.size
    s = 1200.0 / W
    im = im.resize((int(W * s), int(H * s)), Image.BILINEAR)
    a = np.asarray(im).astype(np.int16)
    imgs.append(a)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    warm = (R - B > 55) & (R > 195) & (R >= G)
    white = (R > 246) & (G > 240) & (B > 225)
    masks.append((warm, white, R, G, B))

ws = np.stack([m[0] for m in masks]); wh = np.stack([m[1] for m in masks])
static_w = (ws.all(axis=0)); static_wh = (wh.all(axis=0))
k = np.ones((5, 5), np.uint8)
static_w = cv2.dilate(static_w.astype(np.uint8), k, 1).astype(bool)
static_wh = cv2.dilate(static_wh.astype(np.uint8), k, 1).astype(bool)
print('静态 UI 像素（已剔除） warm=%d white=%d' % (static_w.sum(), static_wh.sum()))

h, w = ws.shape[1:]
rows = []
for i, f in enumerate(files, start=1):
    warm, white, R, G, B = masks[i - 1]
    wm = warm & ~static_w
    hm = white & ~static_wh

    def cc(mask):
        n, lab, st, ce = cv2.connectedComponentsWithStats(mask.astype(np.uint8) * 255, 8, cv2.CV_32S)
        if n <= 1: return None
        kk = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        area = int(st[kk, cv2.CC_STAT_AREA])
        ys, xs = np.nonzero(lab == kk)
        cx, cy = xs.mean() / w, ys.mean() / h
        d = np.hypot(xs - cx * w, ys - cy * h)
        return {'area': area, 'pct': round(100.0 * area / (w * h), 3),
                'cx': round(cx, 3), 'cy': round(cy, 3),
                'bw': round(st[kk, cv2.CC_STAT_WIDTH] / w, 3),
                'bh': round(st[kk, cv2.CC_STAT_HEIGHT] / h, 3),
                'r95': round(float(np.percentile(d, 95)) / h, 4),
                'rmax': round(float(d.max()) / h, 4),
                'fill': round(area / max(1, st[kk, cv2.CC_STAT_WIDTH] * st[kk, cv2.CC_STAT_HEIGHT]), 3)}

    row = {'seq': i, 'warm_area': int(wm.sum()), 'warm_pct': round(100.0 * wm.sum() / (w * h), 3),
           'warm_cc': cc(wm), 'white_area': int(hm.sum()), 'white_pct': round(100.0 * hm.sum() / (w * h), 3),
           'white_cc': cc(hm)}
    if wm.sum() > 50:
        mean = [round(float(x[wm].mean())) for x in (R, G, B)]
        row['warm_rgb'] = mean
        row['warm_peak'] = [int(R[wm].max()), int(G[wm].max()), int(B[wm].max())]
    rows.append(row)

for r in rows:
    c, wh_ = r['warm_cc'], r['white_cc']
    f1 = ('%5.2f%% %4.2fx%4.2f r95=%5.3f fill=%.2f @(%.2f,%.2f)' % (c['pct'], c['bw'], c['bh'], c['r95'], c['fill'], c['cx'], c['cy'])) if c else '        ---'
    f2 = ('%5.2f%% %4.2fx%4.2f r95=%5.3f' % (wh_['pct'], wh_['bw'], wh_['bh'], wh_['r95'])) if wh_ else '   ---'
    print('%2d | warm_all=%5.2f%% cc: %s | rgb=%s | white cc: %s' % (
        r['seq'], r['warm_pct'], f1, r.get('warm_rgb', '-'), f2))

json.dump(rows, open(os.path.join(SRC, '时间轴量化.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# 保存剔UI后的爆点蒙版长条图，便于人眼核对
tiles = []
for i, f in enumerate(files, start=1):
    warm, white, R, G, B = masks[i - 1]
    vis = np.zeros((h, w, 3), np.uint8)
    vis[(warm & ~static_w)] = (255, 90, 40)
    vis[(white & ~static_wh)] = (255, 255, 255)
    vis = cv2.resize(vis, (w // 3, h // 3))
    cv2.putText(vis, str(i), (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    tiles.append(vis)
strip = np.concatenate([np.concatenate(tiles[:8], axis=1), np.concatenate(tiles[8:], axis=1)], axis=0)
cv2.imwrite(os.path.join(SRC, '..', '爆裂黎明_蒙版条.png'), strip)
print('蒙版条 ->', os.path.join(SRC, '..', '爆裂黎明_蒙版条.png'), strip.shape)
