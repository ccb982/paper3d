# -*- coding: utf-8 -*-
"""裁剪/ 16 帧 -> 4x4 接触表（覆盖上一版，避免留下过期的接触表）。"""
import os
import numpy as np, cv2
from PIL import Image

SRC = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_按序\裁剪'
files = sorted([f for f in os.listdir(SRC) if f.endswith('.png')], key=lambda s: int(s[:2]))
tiles = []
for f in files:
    a = np.asarray(Image.open(os.path.join(SRC, f)).convert('RGB'))[:, :, ::-1].copy()
    t = cv2.resize(a, (a.shape[1] // 2, a.shape[0] // 2), interpolation=cv2.INTER_AREA)
    cv2.rectangle(t, (0, 0), (t.shape[1] - 1, t.shape[0] - 1), (70, 70, 70), 2)
    n = os.path.splitext(f)[0]
    cv2.putText(t, n, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 6)
    cv2.putText(t, n, (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (60, 255, 255), 2)
    tiles.append(t)
grid = np.concatenate([np.concatenate(tiles[i:i + 4], axis=1) for i in range(0, len(tiles), 4)], axis=0)
out = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁剪_接触表.png'
ok, buf = cv2.imencode('.png', grid, [cv2.IMWRITE_PNG_COMPRESSION, 6])
open(out, 'wb').write(buf.tobytes())
print(out, grid.shape, '%.1f MB' % (os.path.getsize(out) / 1048576))
