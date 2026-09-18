# -*- coding: utf-8 -*-
"""右半序列 -> 4x4 接触表（1/2 缩放）。注意：中文路径不能用 cv2.imread/imwrite。"""
import os
import numpy as np, cv2
from PIL import Image

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序\右半'
files = sorted([f for f in os.listdir(SRC) if f.endswith('.png')], key=lambda s: int(s[:2]))
print('tiles:', len(files))

tiles = []
for f in files:
    a = np.asarray(Image.open(os.path.join(SRC, f)).convert('RGB'))[:, :, ::-1].copy()  # RGB->BGR
    t = cv2.resize(a, (a.shape[1] // 2, a.shape[0] // 2), interpolation=cv2.INTER_AREA)
    cv2.rectangle(t, (0, 0), (t.shape[1] - 1, t.shape[0] - 1), (60, 60, 60), 2)
    name = os.path.splitext(f)[0]
    cv2.putText(t, name, (12, 44), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 7)
    cv2.putText(t, name, (12, 44), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (60, 255, 255), 2)
    tiles.append(t)

grid = np.concatenate([np.concatenate(tiles[i:i + 4], axis=1) for i in range(0, len(tiles), 4)], axis=0)
out = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_右半_接触表.png'
ok, buf = cv2.imencode('.png', grid, [cv2.IMWRITE_PNG_COMPRESSION, 6])
open(out, 'wb').write(buf.tobytes())
print(out, grid.shape, '%.1f MB' % (os.path.getsize(out) / 1048576))
