# -*- coding: utf-8 -*-
"""收尾：重生成 glsl/预览页；把抠图黑底帧拼成轻量接触表，便于核对去背景效果。"""
import os, shutil
import numpy as np, cv2
from PIL import Image

UI = r'C:\Users\22641\Desktop\游戏素材\ui页面'
BASE = os.path.join(UI, '爆裂黎明_按序')
A = os.path.join(BASE, '抠图')          # RGBA
B = os.path.join(BASE, '抠图_黑底')     # 黑底 JPG

files = sorted([f for f in os.listdir(B) if f.endswith('.jpg')], key=lambda s: int(s[:2]))
tiles = []
for f in files:
    im = Image.open(os.path.join(B, f)).convert('RGB')
    a = np.asarray(im)[:, :, ::-1].copy()
    t = cv2.resize(a, (a.shape[1] // 3, a.shape[0] // 3), interpolation=cv2.INTER_AREA)
    cv2.rectangle(t, (0, 0), (t.shape[1] - 1, t.shape[0] - 1), (70, 70, 70), 1)
    n = os.path.splitext(f)[0]
    cv2.putText(t, n, (8, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 5)
    cv2.putText(t, n, (8, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (60, 255, 255), 2)
    tiles.append(t)
grid = np.concatenate([np.concatenate(tiles[i:i + 4], 1) for i in range(0, len(tiles), 4)], 0)
out = os.path.join(UI, '爆裂黎明_去背景_接触表.jpg')
Image.fromarray(grid[:, :, ::-1]).save(out, quality=86, optimize=True)
print('去背景接触表:', out, grid.shape, '%.0f KB' % (os.path.getsize(out) / 1024))

# 清掉之前那次自定的「右半」类中间目录残留（若存在）
for p in [os.path.join(BASE, '右半')]:
    if os.path.exists(p):
        dst = os.path.join(r'C:\Users\22641\Desktop\架构重置\.workbuddy\tmp\bd_trash', os.path.basename(p))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.move(p, dst)
        print('归档 ->', dst)

print('\n最终素材目录:')
for r, d, fs in os.walk(BASE):
    print('  %-56s [%d]' % (r.replace(BASE, '.'), len(fs)))
