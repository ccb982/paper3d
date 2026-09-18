# -*- coding: utf-8 -*-
"""在 5% 上移基础上再上移 2% -> 总上移 7%(88px)，作为正式裁剪输出。
   同时：旧探索目录归档、接触表/对比图/预览副本重生成（全部轻量 JPG）。"""
import os, json, shutil
import numpy as np, cv2
from PIL import Image

UI = r'C:\Users\22641\Desktop\游戏素材\ui页面'
BASE = os.path.join(UI, '爆裂黎明_按序')
OUT = os.path.join(BASE, '裁剪')
PRE = os.path.join(BASE, '预览')
TRASH = r'C:\Users\22641\Desktop\架构重置\.workbuddy\tmp\bd_trash'
os.makedirs(TRASH, exist_ok=True)

TOTAL_FRAC = 0.07          # 5% + 2%

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
    return (X0, y0, X0 + CW, y0 + CH), dy


def crop_set(frac, outdir, ext='png', quality=None):
    b, dy = box_at(frac)
    os.makedirs(outdir, exist_ok=True)
    n = 0
    for f in files:
        with Image.open(os.path.join(BASE, f)) as im:
            c = im.convert('RGB').crop(b)
            assert c.size == (CW, CH)
            p = os.path.join(outdir, os.path.splitext(f)[0] + '.' + ext)
            if ext == 'png':
                c.save(p, optimize=True)
            else:
                c.save(p, quality=quality, optimize=True)
        n += 1
    return b, dy, n


BOX, DY, N = crop_set(TOTAL_FRAC, OUT)
print('总上移 %.0f%% = %dpx（5%% 的 63px + 2%% 的 25px）' % (TOTAL_FRAC * 100, DY))
print('标注 y0=%d  ->  新 y0=%d' % (Y0, BOX[1]))
print('正式输出 BOX = %s  ->  %d x %d   (%d 帧)' % (BOX, CW, CH, N))

json.dump({'source_spec': '裁剪范围.json',
           'annotated_normalized': {'x0': nx0, 'y0': ny0, 'x1': nx1, 'y1': ny1},
           'shift_up_frac_of_height': TOTAL_FRAC, 'shift_up_px': DY,
           'shift_up_breakdown': '5% (63px) + 2% (25px) = 88px',
           'image_size': [W, H], 'box_px': list(BOX), 'out_size': [CW, CH]},
          open(os.path.join(OUT, '裁剪参数.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

# ---------- 预览副本 ----------
os.makedirs(PRE, exist_ok=True)
for f in os.listdir(PRE):
    os.remove(os.path.join(PRE, f))
t = 0
for f in sorted(os.listdir(OUT)):
    if not f.endswith('.png'):
        continue
    im = Image.open(os.path.join(OUT, f)).convert('RGB')
    im.thumbnail((700, 700), Image.LANCZOS)
    p = os.path.join(PRE, f.replace('.png', '.jpg'))
    im.save(p, quality=82, optimize=True)
    t += os.path.getsize(p)
print('预览副本 %d 张  %.1f MB' % (len(os.listdir(PRE)), t / 1048576))


def sheet(fracs, probe_idx, dst, cell=2, tag=('crop result', 'box on full frame')):
    img = np.asarray(Image.open(os.path.join(BASE, files[probe_idx])).convert('RGB'))[:, :, ::-1].copy()
    COLW, COLH = CW // cell, CH // cell
    rc, rf = [], []
    for frac in fracs:
        (ax0, ay0, ax1, ay1), dy = box_at(frac)
        sel = abs(frac - TOTAL_FRAC) < 1e-9
        col = (0, 220, 255) if sel else (80, 80, 80)
        c = cv2.resize(img[ay0:ay1, ax0:ax1], (COLW, COLH), interpolation=cv2.INTER_AREA)
        cv2.rectangle(c, (0, 0), (COLW - 1, COLH - 1), col, 3 if sel else 1)
        lab = 'up %.0f%% (%dpx)' % (frac * 100, dy)
        cv2.putText(c, lab, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 0, 0), 6)
        cv2.putText(c, lab, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (60, 255, 255), 2)
        rc.append(c)
        s = COLW / img.shape[1]
        f2 = cv2.resize(img, (COLW, int(img.shape[0] * s)), interpolation=cv2.INTER_AREA)
        cv2.rectangle(f2, (int(ax0 * s), int(ay0 * s)), (int(ax1 * s), int(ay1 * s)),
                      (0, 220, 255) if sel else (0, 0, 255), 3 if sel else 2)
        pad = np.zeros((COLH - f2.shape[0], COLW, 3), np.uint8)
        rf.append(np.concatenate([f2, pad], 0) if f2.shape[0] < COLH else f2[:COLH])
    g = np.concatenate([np.concatenate(rc, 1), np.concatenate(rf, 1)], 0)
    cv2.putText(g, tag[0], (12, COLH - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2)
    cv2.putText(g, tag[1], (12, COLH * 2 - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2)
    Image.fromarray(g[:, :, ::-1]).save(dst, quality=85, optimize=True)
    return dst, g.shape


print('对比图:', sheet([0.05, 0.07, 0.09], 3, os.path.join(UI, '爆裂黎明_裁剪_档位对比.jpg')))

# ---------- 16 帧 4x4 接触表（轻量 JPG） ----------
tiles = []
for f in sorted(os.listdir(OUT)):
    if not f.endswith('.png'):
        continue
    a = np.asarray(Image.open(os.path.join(OUT, f)).convert('RGB'))[:, :, ::-1].copy()
    a = cv2.resize(a, (a.shape[1] // 2, a.shape[0] // 2), interpolation=cv2.INTER_AREA)
    cv2.rectangle(a, (0, 0), (a.shape[1] - 1, a.shape[0] - 1), (80, 80, 80), 2)
    n = os.path.splitext(f)[0]
    cv2.putText(a, n, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 6)
    cv2.putText(a, n, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (60, 255, 255), 2)
    tiles.append(a)
grid = np.concatenate([np.concatenate(tiles[i:i + 4], 1) for i in range(0, len(tiles), 4)], 0)
grid = cv2.resize(grid, (grid.shape[1] * 5 // 8, grid.shape[0] * 5 // 8), interpolation=cv2.INTER_AREA)
cs = os.path.join(UI, '爆裂黎明_裁剪_接触表.jpg')
Image.fromarray(grid[:, :, ::-1]).save(cs, quality=84, optimize=True)
print('接触表:', cs, grid.shape, '%.0f KB' % (os.path.getsize(cs) / 1024))

# ---------- 归档旧产物 ----------
for p in [os.path.join(BASE, '裁剪_上移2%'), os.path.join(UI, '爆裂黎明_裁剪_上移档位对比.jpg')]:
    if os.path.exists(p):
        dst = os.path.join(TRASH, os.path.basename(p))
        if os.path.exists(dst):
            shutil.rmtree(dst) if os.path.isdir(dst) else os.remove(dst)
        shutil.move(p, dst)
        print('归档 ->', dst)
print('\n完成。正式输出目录:', OUT)
