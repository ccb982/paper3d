# -*- coding: utf-8 -*-
"""
build-parts.py —— 海猫组件 → 物理火柴人贴图 + 骨架元数据

做什么
  1. 读 海猫_抠图 里 10 张透明 PNG（每个组件都在同一张 1568x2944 画布上，坐标对齐）
  2. 按 alpha 裁到内容包围盒
  3. ★ 用「全局统一缩放因子」降采样（不是"每个组件都缩到同样高度"——那会破坏比例）
  4. 存 public/parts/<key>.webp
  5. 从相邻组件的 bbox 重叠区反推关节锚点，连同质量参数一起写 public/parts.json

骨架口径（用户定调）
  ★ 「脚和小腿一体化」→ 不新增刚体、不新增自由度。
    10 个组件 = 10 个刚体（1:1），9 个关节（颈 / 肩×2 / 肘×2 / 髋×2 / 膝×2，无踝）。
    站地问题靠「小腿刚体底部再挂一个扁平脚掌碰撞体」解决——同一个 RigidBody，
    只是多一个 collider，物理上仍是一体化。

为什么从素材反推骨架
  素材本身就是按人体分解画的，bbox 的重叠区就是关节所在处。
  这样贴图能严丝合缝地长在刚体上，不需要手调数字。

用法
  python tools/build-parts.py            # 默认 scale=0.5, quality=88
  python tools/build-parts.py --scale 0.75 --quality 92
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

# ---------------------------------------------------------------- 路径
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC_DIR = r"C:\Users\22641\Desktop\游戏素材\ui页面\海猫_抠图"
OUT_DIR = os.path.join(ROOT, "public", "parts")

# ---------------------------------------------------------------- 组件定义
# key       = 输出的文件名 / parts.json 里的 id
# file      = 源 PNG 名（不含扩展名）
# label     = 显示名
# bone      = 对应骨架环节
# z         = 绘制层级（数字大的贴在上面），按上一轮合成验证过的顺序
PARTS = [
    # 腿（最里层）
    {"key": "shin_l",  "file": "猫的左小腿", "label": "左小腿", "bone": "shinL",  "z": 10},
    {"key": "shin_r",  "file": "猫的右小腿", "label": "右小腿", "bone": "shinR",  "z": 11},
    {"key": "thigh_l", "file": "猫的左大腿", "label": "左大腿", "bone": "thighL", "z": 20},
    {"key": "thigh_r", "file": "猫的右大腿", "label": "右大腿", "bone": "thighR", "z": 21},
    # 躯干
    {"key": "torso",   "file": "猫的身体",   "label": "身体",   "bone": "torso",  "z": 30},
    # 手臂
    {"key": "arm_l",   "file": "猫的左臂",   "label": "左臂",   "bone": "armL",   "z": 40},
    {"key": "arm_r",   "file": "猫的右臂",   "label": "右臂",   "bone": "armR",   "z": 41},
    {"key": "hand_l",  "file": "猫的左手",   "label": "左手",   "bone": "handL",  "z": 50},
    {"key": "hand_r",  "file": "猫的右手",   "label": "右手",   "bone": "handR",  "z": 51},
    # 头（最上层）
    {"key": "head",    "file": "猫的头",     "label": "头",     "bone": "head",   "z": 60},
]

# ---------------------------------------------------------------- 骨架亲子关系
# 关节 = 父环节 bbox 与 子环节 bbox 的重叠区中心（y）+ 重叠区中心（x）
# 无重叠时退化为「最近的边」
JOINTS = [
    # (关节名, 父 key, 子 key, 限位下限°, 限位上限°)
    # 限位取自 MuJoCo humanoid.xml（膝只允许向后弯、肘不反折）
    ("neck",      "torso", "head",    -35,  45),
    ("shoulder_l","torso", "arm_l",   -95,  80),
    ("shoulder_r","torso", "arm_r",   -95,  80),
    ("elbow_l",   "arm_l", "hand_l", -120,  10),
    ("elbow_r",   "arm_r", "hand_r", -120,  10),
    ("hip_l",     "torso", "thigh_l", -80,  60),
    ("hip_r",     "torso", "thigh_r", -80,  60),
    ("knee_l",    "thigh_l", "shin_l", -145,  2),
    ("knee_r",    "thigh_r", "shin_r", -145,  2),
]


def content_bbox(a: np.ndarray, thr: int = 8):
    """alpha 内容包围盒；返回 (x0, y0, x1, y1)（x1/y1 为开区间）"""
    ys, xs = np.where(a > thr)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def joint_anchor(parent_box, child_box):
    """
    父/子 bbox（原画布 px, y 向下）→ 关节锚点。
    y：两框 y 重叠区的中点（这就是"铰链所在的横截面"）；
    x：两框 x 重叠区的中点（贴着力学最近的那条边）。
    """
    px0, py0, px1, py1 = parent_box
    cx0, cy0, cx1, cy1 = child_box

    # --- y
    lo, hi = max(py0, cy0), min(py1, cy1)
    y = (lo + hi) / 2.0 if hi > lo else (py1 if cy0 >= py1 else cy1)

    # --- x：取重叠区中点；无重叠则取两者最近的边
    lo2, hi2 = max(px0, cx0), min(px1, cx1)
    if hi2 > lo2:
        x = (lo2 + hi2) / 2.0
    else:
        x = (px1 + cx0) / 2.0 if cx0 > px1 else (cx1 + px0) / 2.0

    return x, y


def main() -> int:
    ap = argparse.ArgumentParser(description="海猫组件 → 火柴人贴图 + 骨架元数据")
    ap.add_argument("--scale", type=float, default=0.5,
                    help="全局统一缩放因子（所有组件乘同一个数，默认 0.5）")
    ap.add_argument("--quality", type=int, default=88, help="WebP 质量，默认 88")
    ap.add_argument("--src", default=SRC_DIR, help="源目录（含 10 张透明 PNG）")
    ap.add_argument("--out", default=OUT_DIR, help="输出目录")
    ap.add_argument("--png", action="store_true", help="输出 PNG 而不是 WebP")
    args = ap.parse_args()

    if args.scale <= 0 or args.scale > 1:
        print(f"[错误] --scale 必须在 (0, 1]，收到 {args.scale}", file=sys.stderr)
        return 2

    os.makedirs(args.out, exist_ok=True)

    # ---- 1. 读源 + 裁 bbox ----
    loaded = {}
    for p in PARTS:
        src = os.path.join(args.src, p["file"] + ".png")
        if not os.path.exists(src):
            print(f"[错误] 找不到源文件: {src}", file=sys.stderr)
            return 1
        im = Image.open(src).convert("RGBA")
        a = np.array(im)[:, :, 3]
        box = content_bbox(a)
        if box is None:
            print(f"[错误] {p['file']} 全透明，抠图可能失败了", file=sys.stderr)
            return 1
        loaded[p["key"]] = {"img": im.crop(box), "box": box, "src": src}
        print(f"  读入 {p['label']:<4} bbox={box}  内容 {loaded[p['key']]['img'].size[0]}x"
              f"{loaded[p['key']]['img'].size[1]}")

    # ---- 2. 全局统一缩放 ----
    total = 0
    for p in PARTS:
        e = loaded[p["key"]]
        cropped = e["img"]
        w = max(1, round(cropped.width * args.scale))
        h = max(1, round(cropped.height * args.scale))
        small = cropped.resize((w, h), Image.LANCZOS)
        ext = "png" if args.png else "webp"
        dst = os.path.join(args.out, p["key"] + "." + ext)
        if args.png:
            small.save(dst, format="PNG", optimize=True)
        else:
            small.save(dst, format="WEBP", quality=args.quality, method=6)
        size = os.path.getsize(dst)
        total += size
        e["out"] = {"w": w, "h": h, "bytes": size, "file": p["key"] + "." + ext}
    print(f"\n  贴图 {len(PARTS)} 张，合计 {total / 1024:.1f} KB（scale={args.scale}, "
          f"{'PNG' if args.png else f'WebP q{args.quality}'}）")

    # ---- 3. 反推关节锚点（原画布 px） ----
    boxes = {k: v["box"] for k, v in loaded.items()}
    joints = []
    for name, pk, ck, lo, hi in JOINTS:
        x, y = joint_anchor(boxes[pk], boxes[ck])
        joints.append({"name": name, "parent": pk, "child": ck,
                       "x": round(x, 2), "y": round(y, 2),
                       "limitDeg": [lo, hi]})
        print(f"  关节 {name:<11} {pk:<8}→{ck:<8} 锚点 ({x:7.1f}, {y:7.1f})  限位 {lo}°~{hi}°")

    # ---- 4. 画布与整体尺寸（给 TS 侧做世界坐标换算） ----
    all_x0 = min(b[0] for b in boxes.values())
    all_y0 = min(b[1] for b in boxes.values())
    all_x1 = max(b[2] for b in boxes.values())
    all_y1 = max(b[3] for b in boxes.values())
    extent = {"x0": all_x0, "y0": all_y0, "x1": all_x1, "y1": all_y1,
              "w": all_x1 - all_x0, "h": all_y1 - all_y0}

    # ---- 5. 脚掌：★ 小腿与脚一体化（同一刚体，零新增自由度） ----
    # 素材没有单独的「脚」组件，定调是「脚和小腿一体化」→ 不新增刚体、不新增关节。
    # 但纯胶囊的接地只是一个点，站不稳也学不会走；所以在小腿刚体底部再挂一个
    # 扁平「脚掌」碰撞体（同一个 RigidBody 上多一个 collider）拿到接地面积。
    # 尺寸：脚长 = 小腿长 × 0.42（对齐 MuJoCo humanoid 的踝-脚前伸量级），
    #       厚度 = 小腿长 × 0.10；质量比沿用 Dempster 足/小腿 = 1.45% / 4.65%。
    shin_l = boxes["shin_l"]
    shin_len = shin_l[3] - shin_l[1]
    sole = {
        "len": round(shin_len * 0.42, 2),
        "thick": round(shin_len * 0.10, 2),
        "massPercent": 1.45,
    }

    meta = {
        "generator": "tools/build-parts.py",
        "source": args.src,
        "canvas": {"w": 1568, "h": 2944},
        "scale": args.scale,
        "extent": extent,
        "parts": [
            {
                "key": p["key"], "label": p["label"], "bone": p["bone"], "z": p["z"],
                "file": "parts/" + loaded[p["key"]]["out"]["file"],
                "w": loaded[p["key"]]["out"]["w"], "h": loaded[p["key"]]["out"]["h"],
                "bytes": loaded[p["key"]]["out"]["bytes"],
                # bbox 中心在"画布坐标"里的位置（px, y 向下）——装配骨架时定初始位姿
                "cx": (boxes[p["key"]][0] + boxes[p["key"]][2]) / 2.0,
                "cy": (boxes[p["key"]][1] + boxes[p["key"]][3]) / 2.0,
                "bw": boxes[p["key"]][2] - boxes[p["key"]][0],
                "bh": boxes[p["key"]][3] - boxes[p["key"]][1],
            }
            for p in PARTS
        ],
        "joints": joints,
        "sole": sole,
        "bytesTotal": total,
    }

    dst_json = os.path.join(ROOT, "src", "data", "parts.json")
    os.makedirs(os.path.dirname(dst_json), exist_ok=True)
    with open(dst_json, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(f"\n  元数据 → {dst_json}")
    print(f"  角色整体 span: {extent['w']} x {extent['h']} px（画布坐标 x {extent['x0']}~{extent['x1']}, "
          f"y {extent['y0']}~{extent['y1']}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
