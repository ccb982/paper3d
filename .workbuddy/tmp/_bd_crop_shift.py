# -*- coding: utf-8 -*-
"""在用户标注的裁剪框基础上整框上移，重裁 16 帧；并出一张「上移档位对比」供选。"""
import os, json
import numpy as np, cv2
from PIL import Image

BASE = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
OUT = os.path.join(BASE, '裁剪')
SHIFT_FRAC = 0.05          # ★ 上移量 = 5% 画面高（=63px）
VARIANTS = [0.00, 0.05, 0.10, 0.15]

# 用户标注（归一化），不动原文件
nx0, nx1 = 0.39906773795039174, 0.8384799090956561
ny0, ny1 = 0.17975000000000005, 0.8896823849752271

files = sorted([f for f in os.listdir(BASE) if f.endswith('.jpg')], key=lambda s: int(s[:2]))
W, H = Image.open(os.path.join(BASE, files[0])).size
CW = int(round((nx1 - nx0) * W))
CH = int(round((ny1 - ny0) * H))
X0 = int(round(nx0 * W))
Y0 = int(round(ny0 * H))


def box_at(frac):
    dy = int(round(frac * H))
    y0 = max(0, Y0 - dy)
    return (X0, y0, X0 + CW, y0 + CH)


BOX = box_at(SHIFT_FRAC)
print('标注框(未移) y0=%d -> 上移 %dpx (%.0f%% H) -> 新 y0=%d' % (Y0, Y0 - BOX[1], SHIFT_FRAC * 100, BOX[1]))
print('输出框 BOX =', BOX, '->', CW, 'x', CH)


def load(f):
    return Image.open(os.path.join(BASE, f)).convert('RGB')


report = []
for f in files:
    with load(f) as im:
        c = im.crop(BOX)
        assert c.size == (CW, CH)
        dst = os.path.join(OUT, f.replace('.jpg', '.png'))
        c.save(dst, optimize=True)
        arr = np.asarray(c)
    R, G, B = arr[..., 0].astype(np.int16), arr[..., 1].astype(np.int16), arr[..., 2].astype(np.int16)
    m = (R - B > 55) & (R > 195) & (R >= G)
    cy = cx = None
    if m.sum() > 200:
        ys, xs = np.nonzero(m)
        cx, cy = round(xs.mean() / CW, 3), round(ys.mean() / CH, 3)
    report.append({'file': f, 'out': f.replace('.jpg', '.png'), 'size': [CW, CH], 'warm_px': int(m.sum()),
                   'warm_cx': cx, 'warm_cy': cy, 'bytes': os.path.getsize(dst)})

print('\n%-8s %8s %7s %7s %8s' % ('out', 'warm_px', 'cx', 'cy', 'KB'))
for r in report:
    print('%-8s %8d %7s %7s %8.0f' % (r['out'], r['warm_px'], r['warm_cx'], r['warm_cy'], r['bytes'] / 1024))

json.dump({'source_spec': '裁剪范围.json',
           'annotated_normalized': {'x0': nx0, 'y0': ny0, 'x1': nx1, 'y1': ny1},
           'shift_up_px': Y0 - BOX[1], 'shift_up_frac_of_height': SHIFT_FRAC,
           'image_size': [W, H], 'box_px': list(BOX), 'out_size': [CW, CH]},
          open(os.path.join(OUT, '裁剪参数.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# ---------- 上移档位对比（用第 4 帧，爆点最明显） ----------
probe = files[3]
img = np.asarray(load(probe))[:, :, ::-1].copy()          # BGR 全图
COLW, COLH = CW // 2, CH // 2
row_crop, row_full = [], []
for frac in VARIANTS:
    ax0, ay0, ax1, ay1 = box_at(frac)
    sel = abs(frac - SHIFT_FRAC) < 1e-9
    col = (0, 220, 255) if sel else (70, 70, 70)

    t = cv2.resize(img[ay0:ay1, ax0:ax1], (COLW, COLH), interpolation=cv2.INTER_AREA)
    cv2.rectangle(t, (0, 0), (COLW - 1, COLH - 1), col, 3 if sel else 1)
    row_crop.append(t)

    s = COLW / img.shape[1]
    f2 = cv2.resize(img, (COLW, int(img.shape[0] * s)), interpolation=cv2.INTER_AREA)
    sc = COLW / img.shape[1]
    cv2.rectangle(f2, (int(ax0 * sc), int(ay0 * sc)), (int(ax1 * sc), int(ay1 * sc)),
                  (0, 220, 255) if sel else (0, 0, 255), 3 if sel else 2)
    pad = np.zeros((COLH - f2.shape[0], COLW, 3), np.uint8)
    f2 = np.concatenate([f2, pad], axis=0) if f2.shape[0] < COLH else f2[:COLH]
    row_full.append(f2)

for row, tag in ((row_crop, '裁剪结果'), (row_full, '红框=裁在哪')):
    for i, t in enumerate(row):
        lab = 'up %d%%' % round(VARIANTS[i] * 100)
        cv2.putText(t, lab, (10, 38), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 6)
        cv2.putText(t, lab, (10, 38), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (60, 255, 255), 2)
        cv2.putText(t, tag if i == 0 else '', (10, t.shape[0] - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (255, 255, 255), 2)

grid = np.concatenate([np.concatenate(row_crop, axis=1), np.concatenate(row_full, axis=1)], axis=0)
cs = os.path.join(BASE, '..', '爆裂黎明_裁剪_上移档位对比.png')
ok, buf = cv2.imencode('.png', grid, [cv2.IMWRITE_PNG_COMPRESSION, 6])
open(cs, 'wb').write(buf.tobytes())
print('\n输出:', OUT, '%.1f MB' % (sum(r['bytes'] for r in report) / 1048576))
print('档位对比:', cs, grid.shape, '(采用档位=up %d%%，黄框标注)' % round(SHIFT_FRAC * 100))

