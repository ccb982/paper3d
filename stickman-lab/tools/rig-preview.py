#!/usr/bin/env python3
# ============================================================
# rig-preview —— 离屏画出"静姿态下的骨架 + 纹理原位"，用来肉眼验收贴合
# ============================================================
# 为什么需要：用户反馈全是**视觉**问题（关节连不上、手臂一边折一边不折、脚外八…），
# 而浏览器里截图要开 vite + WebGL。这里纯 PIL 就能画：
#   · 纹理层：画布像素 (px,py) → 世界 (Y=(ground−py)·s, Z=−(px−cx)·s)，
#     **不做任何旋转** —— 这正是"纹理不动"在渲染端的定义（qRel 在静姿态 = 单位四元数）。
#   · 骨骼层：每根骨画成"静倾角 + 实测中轴"的胶囊线段 + 半径圆，
#     关节锚点画成圆点（红=球窝关节 肩/髋，橙=铰链 肘/膝，蓝=颈）。
# 于是"骨轴有没有落在贴图上""锚点是不是在两张贴图重叠处""左右对不对称"一眼可见。
#
# 跑法：python tools/rig-preview.py [输出png]
import json
import math
import os
import sys

from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = r"C:\Users\22641\Desktop\游戏素材\ui页面\海猫_抠图"
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "docs", "rig-preview.png")

META = json.load(open(os.path.join(ROOT, "src", "data", "parts.json"), encoding="utf-8"))
AX = json.load(open(os.path.join(ROOT, "src", "data", "limbAxes.json"), encoding="utf-8"))
FILES = {
    "arm_l": "猫的左臂.png", "arm_r": "猫的右臂.png",
    "hand_l": "猫的左手.png", "hand_r": "猫的右手.png",
    "thigh_l": "猫的左大腿.png", "thigh_r": "猫的右大腿.png",
    "shin_l": "猫的左小腿.png", "shin_r": "猫的右小腿.png",
    "torso": "猫的身体.png", "head": "猫的头.png",
}
SEG = ["shin_l", "shin_r", "thigh_l", "thigh_r", "torso", "head",
       "arm_l", "arm_r", "hand_l", "hand_r"]
FOOT_SPLAY_DEG = 25.0     # 与 DEFAULT_CONFIG.footSplayDeg 保持一致
LIMB_RADIUS_SCALE = 0.6

extent = META["extent"]
H = 1.8
S = H / extent["h"]                      # 画布 px → 米
CX = (extent["x0"] + extent["x1"]) / 2
GROUND = extent["y1"]
PX_PER_M = 1 / S

# 视口：世界 Z ∈ [−0.6, 0.6] → 屏幕 x；世界 Y ∈ [0, 1.9] → 屏幕 y（翻转）
VW, VH = 460, 900
SCALE = 1.0                              # 1 米 = SCALE*VW/1.2 像素
MPP = VW / 1.2                           # 米/像素

parts = {p["key"]: p for p in META["parts"]}


def wx(canvas_x: float) -> float:
    """画布 x → 世界 Z（与 skeleton.ts 的 mapZ 同口径，含负号）"""
    return -(canvas_x - CX) * S


def wy(canvas_y: float) -> float:
    return (GROUND - canvas_y) * S


def scr(world_z: float, world_y: float):
    return (VW / 2 + world_z * MPP, VH - 40 - world_y * MPP)


img = Image.new("RGBA", (VW, VH), (26, 28, 34, 255))
d = ImageDraw.Draw(img, "RGBA")

# ---------------- 纹理层（按 z 从大到小画，"大的盖在上面"） ----------------
SRC_CACHE = {}


def src(key):
    if key not in SRC_CACHE:
        SRC_CACHE[key] = Image.open(os.path.join(SRC_DIR, FILES[key])).convert("RGBA")
    return SRC_CACHE[key]


for key in sorted(SEG, key=lambda k: parts[k]["z"]):
    im = src(key)
    bb = im.getbbox()
    if not bb:
        continue
    crop = im.crop(bb)
    # 降采样到屏幕分辨率（画布 1px = S 米 = S·MPP 屏幕像素）
    ratio = S * MPP
    tw = max(1, int(crop.width * ratio))
    th = max(1, int(crop.height * ratio))
    small = crop.resize((tw, th), Image.LANCZOS)
    p = parts[key]
    # 裁剪块左上角在画布上的位置
    ox = p["cx"] - p["bw"] / 2
    oy = p["cy"] - p["bh"] / 2
    sx, sy = scr(wx(ox), wy(oy))
    img.alpha_composite(small, (int(round(sx)), int(round(sy))))

# ---------------- 骨骼层 ----------------
capsule_from_box_note = "半径 = 0.6·bbox 半宽（与 limbRadiusScale 一致）"
for key in SEG:
    p = parts[key]
    if key in ("torso", "head"):
        continue
    a = AX["axes"][key]
    k = a["k"]
    if key.startswith("shin"):
        k = 0.0                     # 站姿修正：膝以下铅垂（见 measure-limb-axes.py）
    y0, y1 = a["proxTip"][1], a["distTip"][1]
    x0, x1 = a["proxTip"][0], a["distTip"][0]
    p0 = scr(wx(x0), wy(y0))
    p1 = scr(wx(x1), wy(y1))
    r = p["bw"] / 2 * LIMB_RADIUS_SCALE * S * MPP
    d.line([p0, p1], fill=(70, 190, 255, 190), width=max(2, int(r * 0.5)))
    d.ellipse([p0[0] - r, p0[1] - r, p0[0] + r, p0[1] + r], outline=(70, 190, 255, 170), width=2)
    d.ellipse([p1[0] - r, p1[1] - r, p1[0] + r, p1[1] + r], outline=(70, 190, 255, 170), width=2)

# 脚掌盒（外八 footSplayDeg）
for side, key in (("l", "shin_l"), ("r", "shin_r")):
    a = AX["axes"][key]
    p = parts[key]
    knee = AX["anchors"][f"knee_{side}"]
    sole_z = wx(knee[0])
    sole_y = S * AX["paw"][side]["thick"] if "thick" in AX["paw"][side] else 0.026
    hx = META["sole"]["len"] / 2 * S * S
    hz = AX["paw"][side]["lateralHalf"] * S
    psi = math.radians(FOOT_SPLAY_DEG) * (1 if side == "r" else -1)
    cy_, sy_ = math.cos(psi), math.sin(psi)
    c = scr(sole_z, sole_y)
    pts = []
    for dx, dz in ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)):
        # 绕竖直轴偏航：局部 (x=前后, z=侧向) → 世界 (X, Z)
        X = dx * cy_ + dz * sy_
        Z = -dx * sy_ + dz * cy_
        pts.append(scr(sole_z + Z, sole_y))
    d.polygon(pts, outline=(255, 210, 60, 220))
    d.line(pts + [pts[0]], fill=(255, 210, 60, 220), width=2)

# 关节锚点
BALL = ("shoulder", "hip")
for name, (axp, ayp) in AX["anchors"].items():
    c = scr(wx(axp), wy(ayp))
    if name.startswith(BALL):
        col, rad = (255, 90, 90, 255), 7
    elif name == "neck":
        col, rad = (120, 255, 160, 255), 6
    else:
        col, rad = (255, 160, 40, 255), 6
    d.ellipse([c[0] - rad, c[1] - rad, c[0] + rad, c[1] + rad], fill=col)
    d.text((c[0] + rad + 2, c[1] - 6), name, fill=(235, 235, 235, 255))

# 地面线 + 高度参考
d.line([(0, scr(0, 0)[1]), (VW, scr(0, 0)[1])], fill=(120, 200, 120, 255), width=2)
for frac, lab in ((0.81, "颈 81%"), (0.782, "肩 78%"), (0.63, "肘 63%"),
                  (0.47, "髋 47%"), (0.235, "膝 23.5%")):
    y = scr(0, H * frac)[1]
    for xx in range(0, VW, 12):
        d.line([(xx, y), (xx + 6, y)], fill=(255, 255, 255, 45), width=1)
    d.text((4, y - 12), lab, fill=(200, 200, 210, 200))

d.text((6, 6), "静姿态：青=骨轴胶囊  黄=脚掌盒(外八%.0f°)  红=肩/髋  橙=肘/膝  绿=颈" % FOOT_SPLAY_DEG,
       fill=(230, 230, 235, 255))
d.text((6, 20), capsule_from_box_note, fill=(160, 165, 175, 255))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.convert("RGB").save(OUT)
print(f"写入 {OUT}  （{VW}x{VH}）")
