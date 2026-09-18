# -*- coding: utf-8 -*-
"""按「红度 = R - max(G,B)」打 ASCII 图：能把红色特效从白色 UI / 灰背景里分离出来。"""
import os, sys
import numpy as np
from PIL import Image

BASE = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序'
BOX = (1117, 138, 2347, 1033)
SEL = [int(x) for x in (sys.argv[1].split(',') if len(sys.argv) > 1 else ['1', '4', '7', '12', '16'])]
CW, CH = 62, 42
RAMP = ' .:-=+*#%@'


def art(a, lo, hi):
    h, w = a.shape
    out = []
    for j in range(CH):
        row = ''
        for i in range(CW):
            blk = a[int(j * h / CH):int((j + 1) * h / CH), int(i * w / CW):int((i + 1) * w / CW)]
            v = (blk.max() - lo) / (hi - lo)
            row += RAMP[min(len(RAMP) - 1, int(max(0.0, min(1.0, v)) * len(RAMP)))]
        out.append(row)
    return out


for s in SEL:
    with Image.open(os.path.join(BASE, '%02d.jpg' % s)) as im:
        rgb = np.asarray(im.convert('RGB').crop(BOX)).astype(np.float32)
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    red = np.maximum(R - np.maximum(G, B), 0)
    print('\n' + '=' * 74)
    print('帧 %02d  红度 max %.0f  p99 %.0f  p90 %.0f   >60 的像素占比 %.2f%%   >150 占比 %.2f%%'
          % (s, red.max(), np.percentile(red, 99), np.percentile(red, 90),
             100 * (red > 60).mean(), 100 * (red > 150).mean()))
    print('--- 红度 R-max(G,B)，0 → 255 ---')
    for r in art(red, 30, 210):
        print('  ' + r)
