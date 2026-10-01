#!/usr/bin/env python3
# ============================================================
# rig3view —— 用**骨架真实变换**渲染正面 / 侧面 / 3-4 三个视图
# ============================================================
# 为什么需要：用户在 3D 里反复看到"纹理和骨架方向不一致""纹理斜穿骨架"，
# 而我用文字推理已经连错三次方向（正面/侧面、绕 X/绕 Z）。
# 这里把 viewer.ts 的公式原样搬过来画，肉眼一次判定：
#   贴图板：mesh.quaternion = qRel·qFix（qFix = 绕 Y +90°），
#           mesh.position   = bodyPos + qBody·plateOffset
#   骨胶囊：沿刚体局部 +Y，长 = body.length，半径 = body.radius
# 跑法：npx tsx tools/_dump.ts && python tools/rig3view.py
import json
import math
import os
import sys

from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = r"C:\Users\22641\Desktop\游戏素材\ui页面\海猫_抠图"
SK = json.load(open(os.path.join(ROOT, "tools", "_skel.json"), encoding="utf-8"))
META = json.load(open(os.path.join(ROOT, "src", "data", "parts.json"), encoding="utf-8"))
FILES = {
    "arm_l": "猫的左臂.png", "arm_r": "猫的右臂.png",
    "hand_l": "猫的左手.png", "hand_r": "猫的右手.png",
    "thigh_l": "猫的左大腿.png", "thigh_r": "猫的右大腿.png",
    "shin_l": "猫的左小腿.png", "shin_r": "猫的右小腿.png",
    "torso": "猫的身体.png", "head": "猫的头.png",
}
PART_Z = {p["key"]: p["z"] for p in META["parts"]}


def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz]


def quat_conj(q):
    return [-q[0], -q[1], -q[2], q[3]]


def quat_rot(q, v):
    qv = [q[0], q[1], q[2]]
    t = [2 * (qv[1] * v[2] - qv[2] * v[1]),
         2 * (qv[2] * v[0] - qv[0] * v[2]),
         2 * (qv[0] * v[1] - qv[1] * v[0])]
    return [v[i] + q[3] * t[i] + [qv[1] * t[2] - qv[2] * t[1],
                                   qv[2] * t[0] - qv[0] * t[2],
                                   qv[0] * t[1] - qv[1] * t[0]][i] for i in range(3)]


def quat_axis_angle(axis, ang):
    h = ang / 2
    s = math.sin(h)
    return [axis[0] * s, axis[1] * s, axis[2] * s, math.cos(h)]


QFIX = quat_axis_angle([0, 1, 0], math.pi / 2)     # viewer.ts：绕 Y +90°


def rest_quat(tilt, yaw):
    ht, hy = tilt / 2, yaw / 2
    return [math.sin(ht) * math.cos(hy), math.sin(hy) * math.cos(ht),
            -math.cos(hy) * math.sin(ht), math.cos(hy) * math.cos(ht)]


PANELS = [
    ("正面（沿 -X 看）", (0.0, 0.0, -1.0), (1.0, 0.0, 0.0)),      # 视线方向, 屏幕右
    ("侧面（沿 -Z 看）", (0.0, 0.0, -1.0), (0.0, 0.0, 1.0)),
    ("3/4", (0.62, 0.0, -0.78), (0.78, 0.0, 0.62)),
]
# 上面第一项写错了也无所谓，下面显式给
# 三个面板：正前视(az=0) / 真侧视(az=90,el=0) / 默认 3/4(az=0.72,el=0.26)
def _panel(az, el, title):
    import math as _m
    d = (_m.cos(el) * _m.cos(az), _m.sin(el), _m.cos(el) * _m.sin(az))
    # 屏幕右 = 视线方向 × up 的右手系
    up = (0.0, 1.0, 0.0)
    r = (d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0])
    n = _m.sqrt(sum(c * c for c in r)) or 1.0
    return (title, d, tuple(c / n for c in r))


PANELS = [
    _panel(0.0, 0.0, "正前视 az=0（= 画布面）"),
    _panel(_m_pi := 3.14159265 / 2, 0.0, "真侧视 az=90 el=0（骨骼应竖直）"),
    _panel(0.72, 0.26, "默认 3/4 az=41 el=15"),
]

PW, PH = 300, 640
MPP = 300.0          # 像素/米（特写）
img = Image.new("RGBA", (PW * 3 + 20, PH + 34), (24, 26, 32, 255))
dr = ImageDraw.Draw(img, "RGBA")

SRC = {}


def src(key):
    if key not in SRC:
        SRC[key] = Image.open(os.path.join(SRC_DIR, FILES[key])).convert("RGBA")
    return SRC[key]


def panel_origin(pi):
    return (10 + pi * (PW + 5), 30)


for pi, (title, view, right) in enumerate(PANELS):
    ox, oy = panel_origin(pi)
    up = [0.0, 1.0, 0.0]
    # 正交投影（近似的"侧视/正视"足够看方向问题）
    FOCUS = 1.05      # 特写中心：手臂高度
    def proj(p):
        x, y, z = p
        sx = x * right[0] + y * right[1] + z * right[2]
        sy = -(x * up[0] + y * up[1] + z * up[2])
        return (ox + PW / 2 + sx * MPP, oy + PH - 40 + (FOCUS - y) * MPP)

    dr.rectangle([ox, oy, ox + PW, oy + PH], outline=(70, 74, 86, 255))
    dr.text((ox + 4, oy - 16), title, fill=(220, 224, 235, 255))
    # 地面
    for fy, lab in ((1.45, "肩 1.41"), (1.15, "肘 1.15"), (0.75, "腕 0.75"), (0.0, "地 0.0")):
        yy = proj((0, fy, 0))[1]
        for xx in range(ox, ox + PW, 14):
            dr.line([(xx, yy), (xx + 7, yy)], fill=(255, 255, 255, 40), width=1)
        dr.text((ox + 4, yy - 11), lab, fill=(190, 195, 205, 200))

    bones = []
    order = sorted(SK["bodies"], key=lambda b: (PART_Z.get(b["key"], 0),
                                                -(b["cz"] * right[2] + b["cx"] * right[0])))
    for b in order:
        key = b["key"]
        if key not in FILES:
            continue
        qBody = rest_quat(b["tilt"], b["yaw"])
        qVis = rest_quat(b["tilt"], 0.0)          # restVisualQuatOf
        qRel = quat_mul(qBody, quat_conj(qVis))
        # 板心
        off = quat_rot(qBody, b["plate"])
        center = [b["cx"] + off[0], b["cy"] + off[1], b["cz"] + off[2]]
        # 板子局部轴：qRel·qFix 把 (u,v,0) 映到世界
        qFixWorld = quat_mul(qRel, QFIX)
        ux = quat_rot(qFixWorld, [1, 0, 0])
        uy = quat_rot(qFixWorld, [0, 1, 0])
        w, h = b["plateSize"]
        corners = []
        for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            p = [center[i] + ux[i] * su * w / 2 + uy[i] * sv * h / 2 for i in range(3)]
            corners.append(proj(p))
        im = src(key).crop((int(b["partBox"][0]), int(b["partBox"][1]),
                            int(b["partBox"][0] + b["partBox"][2]),
                            int(b["partBox"][1] + b["partBox"][3])))
        # 贴到四边形（只支持矩形 → 用轴对齐近似：取四角均值缩放）
        x0 = min(c[0] for c in corners); x1 = max(c[0] for c in corners)
        y0 = min(c[1] for c in corners); y1 = max(c[1] for c in corners)
        tw, th = max(1, int(x1 - x0)), max(1, int(y1 - y0))
        im2 = im.resize((tw, th), Image.LANCZOS)
        img.alpha_composite(im2, (int(x0), int(y0)))
        # ★ 骨骼单独收集，**所有贴图画完之后**再画，否则会被后画的贴图盖掉
        top = [b["cx"] + quat_rot(qBody, [0, b["length"] / 2, 0])[i] for i in range(3)]
        bot = [b["cx"] + quat_rot(qBody, [0, -b["length"] / 2, 0])[i] for i in range(3)]
        bones.append((proj(top), proj(bot), b["radius"] * MPP, key))

    # ---- 骨骼（画在贴图之上）----
    for pt, pb, rpx, key in bones:
        dr.line([pt, pb], fill=(80, 200, 255, 220), width=max(2, int(rpx * 0.5)))
        dr.ellipse([pt[0] - rpx, pt[1] - rpx, pt[0] + rpx, pt[1] + rpx],
                   outline=(80, 200, 255, 200), width=2)
        dr.ellipse([pb[0] - rpx, pb[1] - rpx, pb[0] + rpx, pb[1] + rpx],
                   outline=(80, 200, 255, 200), width=2)
        dr.text((pb[0] + rpx + 2, pb[1] - 6), key, fill=(150, 220, 255, 220))

    # 关节锚点
    for j in SK["joints"]:
        c = proj(j["w"])
        col = (255, 90, 90, 255) if j["name"].startswith(("shoulder", "hip")) else (
            (120, 255, 160, 255) if j["name"] == "neck" else (255, 160, 40, 255))
        dr.ellipse([c[0] - 5, c[1] - 5, c[0] + 5, c[1] + 5], fill=col)

dr.text((10, 8), "青=骨胶囊(真实变换)  红=肩/髋  橙=肘/膝  绿=颈    —— 板子=真实 mesh 变换(qRel·qFix)",
        fill=(200, 205, 215, 255))
out = os.path.join(ROOT, "docs", "rig3view.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
img.convert("RGB").save(out)
print("写入", out)
