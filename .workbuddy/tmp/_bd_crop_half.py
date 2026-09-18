# -*- coding: utf-8 -*-
"""批处理：按序帧统一裁「右半边」，输出同尺寸序列 + 接触表。"""
import os
import numpy as np, cv2
from PIL import Image

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
OUT = os.path.join(SRC, '右半')
os.makedirs(OUT, exist_ok=True)

files = sorted([f for f in os.listdir(SRC) if f.endswith('.jpg')], key=lambda s: int(s[:2]))
print('输入帧:', len(files))

sizes = {}
for f in files:
    with Image.open(os.path.join(SRC, f)) as im:
        sizes.setdefault(im.size, []).append(f)
print('原始尺寸分布:', {k: len(v) for k, v in sizes.items()})

W, H = max(sizes, key=lambda k: len(sizes[k]))
BX = W // 2                      # 右半边起点
BOX = (BX, 0, W, H)              # 统一裁剪框
print('统一裁剪框:', BOX, '-> 输出尺寸', W - BX, 'x', H)


report, tiles = [], []
for f in files:
    dst = os.path.join(OUT, f.replace('.jpg', '.png'))
    with Image.open(os.path.join(SRC, f)) as im:
        im = im.convert('RGB').crop(BOX)
        im.save(dst, optimize=True)
        arr = np.asarray(im)
    # 检查爆点是否落在右半框内（用暖亮像素的质心判断）
    R, G, B = arr[..., 0].astype(np.int16), arr[..., 1].astype(np.int16), arr[..., 2].astype(np.int16)
    m = (R - B > 55) & (R > 195) & (R >= G)
    tot = int(m.sum())
    cx = cy = None
    if tot > 200:
        ys, xs = np.nonzero(m)
        cx, cy = round(xs.mean() / im.width, 3), round(ys.mean() / im.height, 3)
    report.append({'file': f, 'size': list(im.size), 'warm_px': tot, 'cx': cx, 'cy': cy,
                   'bytes': os.path.getsize(dst)})
    t = cv2.resize(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), (im.width // 3, im.height // 3))
    cv2.putText(t, os.path.splitext(f)[0], (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
    tiles.append(t)

print('\n%-8s %-12s %8s %6s %6s %9s' % ('file', 'size', 'warm_px', 'cx', 'cy', 'KB'))
for r in report:
    print('%-8s %-12s %8d %6s %6s %9.0f' % (r['file'], 'x'.join(map(str, r['size'])),
          r['warm_px'], r['cx'], r['cy'], r['bytes'] / 1024))

grid = np.concatenate([np.concatenate(tiles[i:i + 4], axis=1) for i in range(0, 16, 4)], axis=0)
cs = os.path.join(SRC, '..', '爆裂黎明_右半_接触表.png')
cv2.imwrite(cs, grid)
print('\n输出:', OUT)
print('接触表:', cs, grid.shape, '总大小 %.1f MB' % (sum(r['bytes'] for r in report) / 1048576))

import json
json.dump({'box': BOX, 'out_size': [W - BX, H], 'frames': report},
          open(os.path.join(OUT, '裁剪说明.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
