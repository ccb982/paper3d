# -*- coding: utf-8 -*-
"""v2：用连通域把「爆点」从红色背景/伤害数字里抠出来，量化时间轴。"""
import os, json
import numpy as np, cv2
from PIL import Image

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
files = sorted([f for f in os.listdir(SRC) if f.endswith('.jpg')], key=lambda s: int(s[:2]))
rows = []

for i, f in enumerate(files, start=1):
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    W, H = im.size
    s = 1200.0 / W
    im = im.resize((int(W * s), int(H * s)), Image.BILINEAR)
    a = np.asarray(im).astype(np.float32)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    h, w = R.shape
    warm = R - np.maximum(G, B)

    def comp(mask, tag):
        mu = (mask.astype(np.uint8)) * 255
        n, lab, stats, cent = cv2.connectedComponentsWithStats(mu, 8, cv2.CV_32S)
        if n <= 1:
            return None
        k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        area = int(stats[k, cv2.CC_STAT_AREA])
        x, y, bw, bh = (int(stats[k, cv2.CC_STAT_LEFT]), int(stats[k, cv2.CC_STAT_TOP]),
                        int(stats[k, cv2.CC_STAT_WIDTH]), int(stats[k, cv2.CC_STAT_HEIGHT]))
        ys, xs = np.nonzero(lab == k)
        cxm, cym = xs.mean(), ys.mean()
        d = np.hypot(xs - cxm, ys - cym)
        return {'tag': tag, 'area': area, 'area_pct': 100.0 * area / (w * h),
                'cx': round(cxm / w, 4), 'cy': round(cym / h, 4),
                'bw': round(bw / w, 3), 'bh': round(bh / h, 3),
                'elong': round(bw / max(1, bh), 3),
                'r95': round(float(np.percentile(d, 95)) / h, 4),
                'rmax': round(float(d.max()) / h, 4),
                'fill': round(area / max(1, bw * bh), 3),
                'e': round(float(warm[lab == k].sum()) / 1e4, 1)}

    strong = comp((warm > 95) & (R > 175), 'strong')      # 强红
    white = comp((R > 235) & (G > 195) & (B > 170), 'white')  # 白热
    row = {'seq': i, 'file': f}
    row['strong'] = strong
    row['white'] = white
    # 强红总量（整屏，做归一用）
    row['strong_all_pct'] = round(100.0 * ((warm > 95) & (R > 175)).sum() / (w * h), 3)
    rows.append(row)

print('seq | strong: area%  bbox(w x h)  elong  r95  cx,cy | white: area%  bbox  r95  cx,cy')
for r in rows:
    s, w_ = r['strong'], r['white']
    def fmt(c):
        if not c: return '   ---  '
        return '%5.2f%% %4.2fx%4.2f %5.2f %5.3f (%4.2f,%4.2f)' % (
            c['area_pct'], c['bw'], c['bh'], c['elong'], c['r95'], c['cx'], c['cy'])
    print('%2d | %s | %s' % (r['seq'], fmt(s), fmt(w_)))

json.dump(rows, open(os.path.join(SRC, '时间轴量化.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
