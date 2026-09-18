# -*- coding: utf-8 -*-
"""渲染 shader（无头 Chrome）-> 切 16 块 -> 与参考帧逐项对比 -> 出一张 A/B 对比图 + 指标表。"""
import os, json, subprocess, sys
import numpy as np, cv2
from PIL import Image

UI = r'C:\Users\22641\Desktop\游戏素材\ui页面'
BASE = os.path.join(UI, '爆裂黎明_按序')
TMPD = os.environ['TEMP']
BOX = (1117, 138, 2347, 1033)
CHROME = r'C:\Users\22641\AppData\Local\Google\Chrome\Application\chrome.exe'
COLS, ROWS, TW, TH = 4, 4, 492, 358
DUR = 1.10


def render():
    subprocess.run([CHROME, '--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
                    '--hide-scrollbars', '--force-device-scale-factor=1',
                    '--window-size=%d,%d' % (COLS * TW, ROWS * TH),
                    '--virtual-time-budget=10000',
                    '--user-data-dir=' + os.path.join(TMPD, 'bd_chrome_profile'),
                    '--no-first-run', '--disable-extensions',
                    '--screenshot=' + os.path.join(TMPD, 'bd_render.png'),
                    'file:///' + os.path.join(TMPD, 'bd_render.html').replace('\\', '/')],
                   capture_output=True, timeout=120)
    p = os.path.join(TMPD, 'bd_render.png')
    if not os.path.exists(p):
        raise SystemExit('渲染失败: 没有输出 PNG')
    return p


def features(rgb):
    """红度特征，和参考帧同一套算法"""
    f = rgb.astype(np.float32)
    R, G, B = f[..., 0], f[..., 1], f[..., 2]
    red = np.maximum(R - np.maximum(G, B), 0)
    m = red > 70
    out = {'pct60': round(100 * (red > 60).mean(), 2), 'pct150': round(100 * (red > 150).mean(), 3),
           'red_max': float(red.max())}
    if m.sum() > 100:
        ys, xs = np.nonzero(m)
        cx, cy = float(xs.mean()), float(ys.mean())
        d = np.hypot(xs - cx, ys - cy)
        r95 = float(np.percentile(d, 95))
        out.update({'cx': round(cx / rgb.shape[1], 3), 'cy': round(cy / rgb.shape[0], 3),
                    'r95n': round(r95 / rgb.shape[0], 3)})
        yy, xx = np.mgrid[0:red.shape[0], 0:red.shape[1]]
        rr = np.hypot(xx - cx, yy - cy) / max(r95, 1e-6)
        prof, _ = np.histogram(rr, 12, (0, 1.5), weights=red)
        cnt, _ = np.histogram(rr, 12, (0, 1.5))
        out['radial'] = (prof / np.maximum(cnt, 1)).round(1).tolist()
        hot = red > 150
        if hot.sum() > 30:
            out['hot_rgb'] = [int(f[..., c][hot].mean()) for c in range(3)]
        c = np.hypot(xx - cx, yy - cy) < 0.25 * r95
        cm = c & (red > 60)
        if cm.sum() > 30:
            out['core_rgb'] = [int(f[..., c2][cm].mean()) for c2 in range(3)]
    return out


# ---------- 参考帧 ----------
files = sorted([f for f in os.listdir(BASE) if f.endswith('.jpg')], key=lambda s: int(s[:2]))
ref, ref_img = [], []
for fn in files:
    with Image.open(os.path.join(BASE, fn)) as im:
        a = np.asarray(im.convert('RGB').crop(BOX))
    ref_img.append(a)
    ref.append(features(a))

# ---------- shader 渲染 ----------
png = render()
big = np.asarray(Image.open(png).convert('RGB'))
sh, sh_img = [], []
for i in range(COLS * ROWS):
    x, y = (i % COLS) * TW, (i // COLS) * TH
    t = np.ascontiguousarray(big[y:y + TH, x:x + TW])
    t[0:34, 0:320] = 0                                  # 抹掉标签，避免污染统计
    sh_img.append(t)
    sh.append(features(t))

print('帧  参考: pct60  pct150  r95n   hot_rgb        | shader: pct60  pct150  r95n   hot_rgb        | 中心色')
for i in range(16):
    a, b = ref[i], sh[i]
    print('%2d  %8.2f %7.3f %6.3f  %-14s | %8.2f %7.3f %6.3f  %-14s | %s vs %s' % (
        i + 1, a['pct60'], a['pct150'], a.get('r95n', -1), a.get('hot_rgb', '-'),
        b['pct60'], b['pct150'], b.get('r95n', -1), b.get('hot_rgb', '-'),
        a.get('core_rgb', '-'), b.get('core_rgb', '-')))

rm = np.mean([r['pct60'] for r in ref])
sm = np.mean([r['pct60'] for r in sh])
print('\n平均 pct60: 参考 %.2f  shader %.2f  (比值 %.2f)' % (rm, sm, sm / rm))
print('峰值 pct60: 参考 %.2f(#%d)  shader %.2f(#%d)' % (
    max(r['pct60'] for r in ref), 1 + int(np.argmax([r['pct60'] for r in ref])),
    max(r['pct60'] for r in sh), 1 + int(np.argmax([r['pct60'] for r in sh]))))
# 径向轮廓相关性（用峰值帧）
ai = int(np.argmax([r['pct60'] for r in ref]))
a1, b1 = np.array(ref[ai]['radial']), np.array(sh[ai]['radial'])
print('峰值帧径向轮廓相关: %.3f   (参考#%d)' % (np.corrcoef(a1, b1)[0, 1], ai + 1))
print('  参考 %s' % a1.tolist())
print('  shader %s' % b1.tolist())

# ---------- A/B 对比图 ----------
cells = []
for i in range(16):
    a = cv2.resize(np.ascontiguousarray(ref_img[i][:, :, ::-1]), (TW, TH), interpolation=cv2.INTER_AREA)
    b = np.ascontiguousarray(sh_img[i][:, :, ::-1])
    cv2.putText(a, 'REF #%d' % (i + 1), (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 5)
    cv2.putText(a, 'REF #%d' % (i + 1), (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 220, 255), 2)
    cv2.putText(b, 'SHADER #%d' % (i + 1), (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 5)
    cv2.putText(b, 'SHADER #%d' % (i + 1), (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (120, 255, 120), 2)
    c = np.concatenate([a, b], 0)
    cv2.line(c, (0, TH), (TW, TH), (255, 255, 255), 1)
    cells.append(c)
grid = np.concatenate([np.concatenate(cells[i:i + 4], 1) for i in range(0, 16, 4)], 0)
# 底部指标条：红度覆盖曲线
HW, HH = 1968, 260
plot = np.full((HH, HW, 3), 18, np.uint8)
mx = max(max(r['pct60'] for r in ref), max(r['pct60'] for r in sh)) * 1.1
for series, col, lab in ((ref, (0, 220, 255), 'REF'), (sh, (120, 255, 120), 'SHADER')):
    pts = []
    for i, r in enumerate(series):
        x = int((i + 0.5) / 16 * HW); y = int(HH - 30 - r['pct60'] / mx * (HH - 70))
        pts.append((x, y))
    cv2.polylines(plot, [np.array(pts, np.int32)], False, col, 3)
    for (x, y) in pts:
        cv2.circle(plot, (x, y), 5, col, -1)
cv2.putText(plot, 'red-coverage (RED>60) vs frame index   max=%.1f' % mx, (14, 26),
            cv2.FONT_HERSHEY_SIMPLEX, 0.75, (235, 235, 235), 2)
cv2.putText(plot, 'REF', (14, HH - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 220, 255), 2)
cv2.putText(plot, 'SHADER', (80, HH - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (120, 255, 120), 2)
grid = np.concatenate([grid, plot], 0)
grid = cv2.resize(grid, (grid.shape[1] // 2, grid.shape[0] // 2), interpolation=cv2.INTER_AREA)
out = os.path.join(UI, '爆裂黎明_shader对比.jpg')
Image.fromarray(grid[:, :, ::-1]).save(out, quality=86, optimize=True)
print('\n对比图:', out, grid.shape, '%.0f KB' % (os.path.getsize(out) / 1024))
