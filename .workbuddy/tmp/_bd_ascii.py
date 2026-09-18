# -*- coding: utf-8 -*-
"""把抠图结果打成 ASCII 图，便于「用文本看形状」。"""
import os, sys
import numpy as np
from PIL import Image

BASE = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
BOX = (1117, 138, 2347, 1033)
SEL = [int(x) for x in (sys.argv[1].split(',') if len(sys.argv) > 1 else ['1', '4', '7', '12'])]
CW, CH = 56, 40
RAMP = ' .:-=+*#%@'


def load(fn):
    with Image.open(os.path.join(BASE, fn)) as im:
        return np.asarray(im.convert('RGB').crop(BOX))


def art(a, mx):
    h, w = a.shape
    out = []
    for j in range(CH):
        row = ''
        for i in range(CW):
            blk = a[int(j * h / CH):int((j + 1) * h / CH), int(i * w / CW):int((i + 1) * w / CW)]
            v = blk.mean() / mx if mx else 0
            row += RAMP[min(len(RAMP) - 1, int(max(0.0, min(1.0, v)) * len(RAMP)))]
        out.append(row)
    return out


for s in SEL:
    fn = '%02d.jpg' % s
    rgb = load(fn).astype(np.float32)
    a = np.asarray(Image.open(os.path.join(BASE, '抠图', '%02d.png' % s)).convert('RGBA'))[:, :, 3].astype(np.float32) / 255.0
    lum = np.max(rgb, axis=2)
    print('\n' + '=' * 70)
    print('帧 %02d   亮度: min %.0f  p50 %.0f  p90 %.0f  p99 %.0f  max %.0f   抠图覆盖 %.1f%%'
          % (s, lum.min(), np.percentile(lum, 50), np.percentile(lum, 90), np.percentile(lum, 99),
             lum.max(), 100 * (a > 0.35).mean()))
    print('--- 原图亮度（. 最暗 @ 最亮）---')
    for r in art(lum, 255):
        print('  ' + r)
    print('--- 抠出的 alpha ---')
    for r in art(a, 1.0):
        print('  ' + r)
