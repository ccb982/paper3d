# -*- coding: utf-8 -*-
"""量一下：海猫 10 个组件在「裁 bbox + 降采样」之后，各种格式/尺寸下的总体积。
目的：为 stickman-lab 选一个能塞进 1MB（纹理+数据）的贴图方案。"""
import os, io, json
import numpy as np
from PIL import Image

SRC = r"C:\Users\22641\Desktop\游戏素材\ui页面\海猫_抠图"
OUT = r"C:\Users\22641\Desktop\架构重置\.workbuddy\tmp\tex_probe"
os.makedirs(OUT, exist_ok=True)

names = ["猫的头", "猫的身体", "猫的左臂", "猫的右臂", "猫的左手", "猫的右手",
         "猫的左大腿", "猫的右大腿", "猫的左小腿", "猫的右小腿"]

def load(n):
    im = Image.open(os.path.join(SRC, n + ".png")).convert("RGBA")
    a = np.array(im)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return im, (0, 0, im.width, im.height)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return im.crop(box), box

print("=== 各组件 alpha 包围盒（原画布 1568x2944） ===")
info = []
for n in names:
    c, box = load(n)
    info.append((n, box, c.size))
    print(f"  {n:<8} bbox=({box[0]:>4},{box[1]:>4})-({box[2]:>4},{box[3]:>4})  "
          f"内容 {c.size[0]:>4}x{c.size[1]:<4}  占画布 {c.size[0]*c.size[1]/(1568*2944)*100:5.1f}%  "
          f"像素 {c.size[0]*c.size[1]/1000:6.1f}k")

print()
print("=== 全角色对齐（含 bbox 偏移，用于反推骨架锚点） ===")
for n, box, size in info:
    pass

def total_bytes(save_fn, tag):
    tot = 0
    per = []
    for n in names:
        c, _ = load(n)
        im = save_fn(c)
        b = io.BytesIO()
        im.save(b, **({"format": "WEBP"} if tag.startswith("webp") else {"format": "PNG", "optimize": True}))
        per.append((n, b.tell()))
        tot += b.tell()
    return tot, per

print()
print("=== 尺寸/格式 扫描（总字节 = 10 个组件之和） ===")
rows = []
for H in (96, 128, 160, 192, 256, 320):
    def mk(c, H=H):
        w = max(1, round(c.width * H / c.height))
        return c.resize((w, H), Image.LANCZOS)
    # PNG 直存
    tot, per = total_bytes(mk, f"png{H}")
    rows.append((f"PNG  H={H:<4}", tot))
    # WebP q=85
    def mk2(c, H=H):
        w = max(1, round(c.width * H / c.height))
        return c.resize((w, H), Image.LANCZOS)
    tot2 = 0
    for n in names:
        c, _ = load(n)
        b = io.BytesIO()
        mk2(c).save(b, format="WEBP", quality=85, method=6)
        tot2 += b.tell()
    rows.append((f"WebP H={H:<4} q85", tot2))

for tag, tot in rows:
    print(f"  {tag}  →  {tot/1024:7.1f} KB {'  ✅' if tot < 1024*1024*0.4 else ''}")
