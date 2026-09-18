# -*- coding: utf-8 -*-
"""再出 2% 上移档（放进单独目录），并生成 0/2/5% 三档对比（轻量 JPG）。"""
import os, json
import numpy as np, cv2
from PIL import Image

BASE = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
OUT2 = os.path.join(BASE, '裁剪_上移2%')
os.makedirs(OUT2, exist_ok=True)

nx0, nx1 = 0.39906773795039174, 0.8384799090956561
ny0, ny1 = 0.17975000000000005, 0.8896823849752271
SHIFT = 0.02                      # ★ 本次：上移 2%

files = sorted([f for f in os.listdir(BASE) if f.endswith('.jpg')], key=lambda s: int(s[:2]))
W, H = Image.open(os.path.join(BASE, files[0])).size
CW = int(round((nx1 - nx0) * W))
CH = int(round((ny1 - ny0) * H))
X0 = int(round(nx0 * W))
Y0 = int(round(ny0 * H))


def box_at(frac):
    dy = int(round(frac * H))
    y0 = max(0, Y0 - dy)
    return (X0, y0, X0 + CW, y0 + CH), dy


BOX, DY = box_at(SHIFT)
print('标注 y0=%d  +上移 %dpx (%.0f%%H)  ->  BOX=%s  %dx%d' % (Y0, DY, SHIFT * 100, BOX, CW, CH))

tot = 0
for f in files:
    im = Image.open(os.path.join(BASE, f)).convert('RGB')
    c = im.crop(BOX)
    assert c.size == (CW, CH)
    p = os.path.join(OUT2, f.replace('.jpg', '.png'))
    c.save(p, optimize=True)
    tot += os.path.getsize(p)
print('2%% 档输出 %d 帧 -> %s  %.1f MB' % (len(files), OUT2, tot / 1048576))

json.dump({'source_spec': '裁剪范围.json', 'shift_up_px': DY, 'shift_up_frac_of_height': SHIFT,
           'image_size': [W, H], 'box_px': list(BOX), 'out_size': [CW, CH]},
          open(os.path.join(OUT2, '裁剪参数.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# ---------- 0 / 2% / 5% 对比（第 4 帧） ----------
FRACS = [0.0, 0.02, 0.05]
probe = files[3]
img = np.asarray(Image.open(os.path.join(BASE, probe)).convert('RGB'))[:, :, ::-1].copy()
COLW, COLH = CW // 2, CH // 2
row_crop, row_full = [], []
for frac in FRACS:
    b, dy = box_at(frac)
    ax0, ay0, ax1, ay1 = b
    sel = abs(frac - SHIFT) < 1e-9
    col = (0, 220, 255) if sel else (70, 70, 70)
    t = cv2.resize(img[ay0:ay1, ax0:ax1], (COLW, COLH), interpolation=cv2.INTER_AREA)
    cv2.rectangle(t, (0, 0), (COLW - 1, COLH - 1), col, 3 if sel else 1)
    lab = 'up %.0f%% (%dpx)' % (frac * 100, dy)
    cv2.putText(t, lab, (10, 38), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 6)
    cv2.putText(t, lab, (10, 38), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (60, 255, 255), 2)
    row_crop.append(t)

    s = COLW / img.shape[1]
    f2 = cv2.resize(img, (COLW, int(img.shape[0] * s)), interpolation=cv2.INTER_AREA)
    cv2.rectangle(f2, (int(ax0 * s), int(ay0 * s)), (int(ax1 * s), int(ay1 * s)),
                  (0, 220, 255) if sel else (0, 0, 255), 3 if sel else 2)
    pad = np.zeros((COLH - f2.shape[0], COLW, 3), np.uint8)
    f2 = np.concatenate([f2, pad], 0) if f2.shape[0] < COLH else f2[:COLH]
    row_full.append(f2)

grid = np.concatenate([np.concatenate(row_crop, 1), np.concatenate(row_full, 1)], 0)
sheet = grid.copy()
cv2.putText(sheet, 'crop result', (12, COLH - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
cv2.putText(sheet, 'box on full frame', (12, COLH * 2 - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
sheet = cv2.resize(sheet, (sheet.shape[1] * 3 // 4, sheet.shape[0] * 3 // 4), interpolation=cv2.INTER_AREA)
dst = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁剪_档位对比.jpg'
Image.fromarray(sheet[:, :, ::-1]).save(dst, quality=85, optimize=True)
print('对比图:', dst, sheet.shape, '%.0f KB' % (os.path.getsize(dst) / 1024), '黄框=本次 2% 档')
