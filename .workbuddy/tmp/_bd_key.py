# -*- coding: utf-8 -*-
"""把裁剪帧的特效从背景里抠出来（局部对比度 + 暖色门限），导出 RGBA，并测量形状/配色特征。"""
import os, json
import numpy as np, cv2
from PIL import Image

BASE = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
OUT_A = os.path.join(BASE, '抠图')          # RGBA
OUT_B = os.path.join(BASE, '抠图_黑底')     # 黑底合成，肉眼核对
os.makedirs(OUT_A, exist_ok=True)
os.makedirs(OUT_B, exist_ok=True)

BOX = (1117, 138, 2347, 1033)               # 用户最终确认的框（总上移 7%），1230x895
files = sorted([f for f in os.listdir(BASE) if f.endswith('.jpg')], key=lambda s: int(s[:2]))
print('输入 %d 帧，裁剪框 %s -> %dx%d' % (len(files), BOX, BOX[2] - BOX[0], BOX[3] - BOX[1]))


def load_crop(fn):
    with Image.open(os.path.join(BASE, fn)) as im:
        return np.asarray(im.convert('RGB').crop(BOX))


def key(rgb):
    """rgb uint8 HxWx3 -> (alpha float 0..1, 诊断 dict)"""
    f = rgb.astype(np.float32)
    R, G, B = f[..., 0], f[..., 1], f[..., 2]
    lum = np.max(f, axis=2)
    # 背景估计：大核中值（发光体比背景亮得多，中值不会被小面积高光带跑）
    bg = cv2.medianBlur(rgb, 61).astype(np.float32)
    bgl = np.max(bg, axis=2)
    d = np.clip(lum - bgl, 0, None)
    # 暖色门限：红明显高于蓝（白热核心用亮度豁免）
    warm = R - B
    gate = ((warm > 18) | (lum > 232)).astype(np.float32)
    # 软过渡，避免硬边
    gate = cv2.GaussianBlur(gate, (0, 0), 2.0)
    a = d / (d + 45.0)                      # 0..1 软饱和
    a = np.clip(a * gate, 0, 1)
    # 去掉孤立噪点
    a = cv2.GaussianBlur(a, (0, 0), 1.2)
    return a, {'bg_lum_p95': float(np.percentile(bgl, 95)), 'd_p99': float(np.percentile(d, 99)),
               'gate_pct': float(100 * (gate > 0.5).mean())}


def radial_profile(a, cx, cy, rmax, bins=16):
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(xx - cx, yy - cy) / max(rmax, 1e-6)
    prof, _ = np.histogram(r, bins=bins, range=(0, 1), weights=a)
    cnt, _ = np.histogram(r, bins=bins, range=(0, 1))
    return (prof / np.maximum(cnt, 1)).round(4).tolist()


def angular_spectrum(a, cx, cy, rlo, rhi, nb=256):
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(xx - cx, yy - cy)
    m = (r >= rlo) & (r < rhi)
    if m.sum() < 50:
        return None
    ang = np.arctan2(yy[m] - cy, xx[m] - cx)
    idx = ((ang + np.pi) / (2 * np.pi) * nb).astype(int) % nb
    acc = np.bincount(idx, weights=a[m], minlength=nb)
    cnt = np.bincount(idx, minlength=nb)
    p = acc / np.maximum(cnt, 1)
    p = p - p.mean()
    F = np.abs(np.fft.rfft(p))
    tot = F.sum() + 1e-6
    return {'h_top': int(np.argmax(F[1:]) + 1), 'h_top_share': round(float(F[1:].max() / tot), 3),
            'profile': (p / (np.abs(p).max() + 1e-6)).round(3).tolist()[:64]}


report = []
for i, fn in enumerate(files, start=1):
    rgb = load_crop(fn)
    a, diag = key(rgb)
    ys, xs = np.nonzero(a > 0.35)
    rec = {'seq': i, 'file': fn, 'energy': float(a.sum()), 'amax': float(a.max()),
           'area35_pct': round(100.0 * (a > 0.35).mean(), 3), **diag}
    if len(xs) > 50:
        cx, cy = float(xs.mean()), float(ys.mean())
        d = np.hypot(xs - cx, ys - cy)
        r95 = float(np.percentile(d, 95))
        rec.update({'cx': round(cx / rgb.shape[1], 3), 'cy': round(cy / rgb.shape[0], 3),
                    'r95_px': round(r95, 1), 'r95_norm': round(r95 / rgb.shape[0], 3),
                    'rmax_px': round(float(d.max()), 1)})
        # 配色随半径
        f = rgb.astype(np.float32)
        yy, xx = np.mgrid[0:rgb.shape[0], 0:rgb.shape[1]]
        rr = np.hypot(xx - cx, yy - cy)
        for lo, hi, tag in ((0, .25, 'core'), (.25, .6, 'mid'), (.6, 1.05, 'outer')):
            m = (rr >= lo * r95) & (rr < hi * r95) & (a > 0.3)
            if m.sum() > 30:
                rec['rgb_' + tag] = [int(f[..., c][m].mean()) for c in range(3)]
        rec['radial'] = radial_profile(a, cx, cy, r95)
        rec['ang'] = angular_spectrum(a, cx, cy, 0.35 * r95, 0.8 * r95)
    report.append(rec)

    ag = (a * 255).astype(np.uint8)
    rgba = np.dstack([rgb, ag])
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT_A, fn.replace('.jpg', '.png')), optimize=True)
    black = (rgb.astype(np.float32) / 255.0) * a[..., None]
    Image.fromarray((black * 255).astype(np.uint8)).save(
        os.path.join(OUT_B, fn.replace('.jpg', '.jpg')), quality=88, optimize=True)

print('\n%-4s %9s %7s %8s %6s %6s %6s  %-22s %s' % ('seq', 'energy', 'amax', 'area35%', 'cx', 'cy', 'r95n', 'core/mid/outer rgb', 'ang'))
for r in report:
    rgb_s = ' '.join('%s' % (r.get('rgb_' + t, '-')) for t in ('core', 'mid', 'outer'))
    ang = r.get('ang')
    ang_s = ('h=%d share=%.2f' % (ang['h_top'], ang['h_top_share'])) if ang else '-'
    print('%-4d %9.0f %7.3f %8.3f %6s %6s %6s  %-22s %s' % (
        r['seq'], r['energy'], r['amax'], r['area35_pct'], r.get('cx', '-'), r.get('cy', '-'),
        r.get('r95_norm', '-'), rgb_s, ang_s))

top = sorted(report, key=lambda r: -r['energy'])[:3]
print('\n=== 能量最大的 3 帧的径向 alpha 轮廓（16 桶, r/r95 = 0.03→0.97）===')
for r in top:
    print('  #%-3d energy=%8.0f  %s' % (r['seq'], r['energy'], r.get('radial')))
print('\n=== 同上 3 帧的角向轮廓（64 桶, -1..1, 找尖刺规律）===')
for r in top:
    ang = r.get('ang')
    if ang:
        print('  #%-3d h=%d share=%.2f' % (r['seq'], ang['h_top'], ang['h_top_share']))
        print('      %s' % ang['profile'])

json.dump(report, open(os.path.join(BASE, '抠图特征.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\nRGBA ->', OUT_A, '\n黑底 ->', OUT_B, '\n特征 ->', os.path.join(BASE, '抠图特征.json'))
