# -*- coding: utf-8 -*-
"""按用户标注的 裁剪范围.json 重裁：16 帧统一同一个裁剪框。"""
import os, json
import numpy as np, cv2
from PIL import Image

BASE = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
SPEC = os.path.join(BASE, '裁剪范围.json')
OUT = os.path.join(BASE, '裁剪')
os.makedirs(OUT, exist_ok=True)

# ---- 读标注：取 text == '裁剪范围' 的那个多边形，求其外接矩形（归一化） ----
spec = json.load(open(SPEC, encoding='utf-8'))
ann = None
for layer in spec['layers']:
    for a in layer['annotations']:
        if a.get('text') == '裁剪范围':
            ann = a
if ann is None:
    raise SystemExit('没找到 text=裁剪范围 的标注')

pts = [p for ring in ann['polygon'] for p in ring]
nx0 = min(p['x'] for p in pts); nx1 = max(p['x'] for p in pts)
ny0 = min(p['y'] for p in pts); ny1 = max(p['y'] for p in pts)
print('归一化裁剪框: x %.6f~%.6f  y %.6f~%.6f' % (nx0, nx1, ny0, ny1))
print('归一化尺寸: w %.6f  h %.6f  (宽高比 %.3f)' % (nx1 - nx0, ny1 - ny0, (nx1 - nx0) / (ny1 - ny0)))

files = sorted([f for f in os.listdir(BASE) if f.endswith('.jpg')], key=lambda s: int(s[:2]))
print('输入帧:', len(files))

# ---- 用第一帧的像素尺寸把归一化框定死成整数像素框，之后 16 帧共用它 ----
W, H = Image.open(os.path.join(BASE, files[0])).size
x0, y0 = int(round(nx0 * W)), int(round(ny0 * H))
x1, y1 = int(round(nx1 * W)), int(round(ny1 * H))
BOX = (x0, y0, x1, y1)
CW, CH = x1 - x0, y1 - y0
print('像素裁剪框 BOX = %s  -> 输出 %d x %d' % (BOX, CW, CH))

report = []
for f in files:
    with Image.open(os.path.join(BASE, f)) as im:
        if im.size != (W, H):
            raise SystemExit('%s 尺寸不同: %s' % (f, im.size))
        c = im.convert('RGB').crop(BOX)
        assert c.size == (CW, CH), c.size
        dst = os.path.join(OUT, f.replace('.jpg', '.png'))
        c.save(dst, optimize=True)
        arr = np.asarray(c)
    # 参考量：暖亮像素质心（相对裁剪框），只做粗查
    R, G, B = arr[..., 0].astype(np.int16), arr[..., 1].astype(np.int16), arr[..., 2].astype(np.int16)
    m = (R - B > 55) & (R > 195) & (R >= G)
    cx = cy = None
    if m.sum() > 200:
        ys, xs = np.nonzero(m)
        cx, cy = round(xs.mean() / CW, 3), round(ys.mean() / CH, 3)
    report.append({'file': f, 'out': os.path.basename(dst), 'size': [CW, CH],
                   'warm_px': int(m.sum()), 'warm_cx': cx, 'warm_cy': cy,
                   'bytes': os.path.getsize(dst)})

print('\n%-8s %-11s %8s %7s %7s %8s' % ('in', 'out', 'warm_px', 'cx', 'cy', 'KB'))
for r in report:
    print('%-8s %-11s %8d %7s %7s %8.0f' % (r['file'], r['out'], r['warm_px'], r['warm_cx'], r['warm_cy'], r['bytes'] / 1024))

json.dump({'source_spec': '裁剪范围.json', 'normalized': {'x0': nx0, 'y0': ny0, 'x1': nx1, 'y1': ny1},
           'image_size': [W, H], 'box_px': list(BOX), 'out_size': [CW, CH]},
          open(os.path.join(OUT, '裁剪参数.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# 11/2 缩放接触表：4 列
tiles = []
for r in report:
    a = np.asarray(Image.open(os.path.join(OUT, r['out'])).convert('RGB'))[:, :, ::-1].copy()
    t = cv2.resize(a, (a.shape[1] // 2, a.shape[0] // 2), interpolation=cv2.INTER_AREA)
    cv2.rectangle(t, (0, 0), (t.shape[1] - 1, t.shape[0] - 1), (70, 70, 70), 2)
    cv2.putText(t, r['out'][:2], (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 6)
    cv2.putText(t, r['out'][:2], (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (60, 255, 255), 2)
    tiles.append(t)
rows = [np.concatenate(tiles[i:i + 4], axis=1) for i in range(0, len(tiles), 4)]
grid = np.concatenate(rows, axis=0)
cs = os.path.join(BASE, '..', '爆裂黎明_裁剪_接触表.png')
ok, buf = cv2.imencode('.png', grid, [cv2.IMWRITE_PNG_COMPRESSION, 6])
open(cs, 'wb').write(buf.tobytes())
print('\n输出:', OUT, '共 %d 帧  %.1f MB' % (len(report), sum(r['bytes'] for r in report) / 1048576))
print('接触表:', cs, grid.shape)
