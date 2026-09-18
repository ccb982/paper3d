# -*- coding: utf-8 -*-
import os
from PIL import Image, ImageDraw

CROP = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_裁切'
OUT = r'C:\Users\22641\Desktop\游戏素材\ui页面\爆裂黎明_爆点对比.png'

picks = ['02', '03', '05', '06', '07', '10', '13', '14', '15', '20']
files = ['frame_%s_crop.png' % p for p in picks]
files = [f for f in files if os.path.exists(os.path.join(CROP, f))]

CW = 700
COLS = 3
rows_n = (len(files) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * CW, rows_n * (CW + 34)), (18, 18, 20))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(os.path.join(CROP, f)).convert('RGB')
    im.thumbnail((CW - 16, CW - 16), Image.LANCZOS)
    cx, cy = (i % COLS) * CW + 8, (i // COLS) * (CW + 34) + 30
    sheet.paste(im, (cx, cy))
    d.text((cx, cy - 24), f.replace('frame_', '#').replace('_crop.png', ''), fill=(245, 245, 245))
sheet.save(OUT)
print(OUT, sheet.size, 'n =', len(files))
