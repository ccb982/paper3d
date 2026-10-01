#!/usr/bin/env python3
# ============================================================
# measure-limb-axes —— 测肢体中轴，求关节锚点，并**保证纹理连得上**
# ============================================================
# 用户回读 2026-10-01 的两条硬要求：
#   ① "我的纹理初始状态，各个部位都是有一定倾斜度的"
#      实测中轴倾角：上臂 7°/3°、前臂+手 31°、大腿 8°、小腿 9°/8°、躯干 0.8°、头 0.6°。
#      ⇒ bbox 重叠区中心当锚点对斜肢体不成立（肩会落进上臂中点，肘会落在矩形中心）。
#   ② "最起码各个肢体的关节必须连起来"
#      ⇒ 锚点必须落在**父/子两张贴图的 alpha 内部**（带余量），否则一转就露缝。
#
# 算法（全部来自像素，无手调）：
#   ① 逐行取 alpha 覆盖区间中点 x̄(y)、行宽 w(y)，按 w 加权最小二乘拟合中轴直线；
#   ② 锚点三级候选，依次降级，取第一个"在父子 alpha 内部且余量 ≥ MARGIN"的：
#      a) 父/子都是肢体且中轴**不近平行**（|Δk| ≥ 0.02）⇒ 两中轴直线求交（真实铰链位置）；
#      b) 父是躯干（肩、髋）⇒ 子肢体近端端心沿中轴向内 6% 轴长（保证在子贴图内部）；
#      c) 兜底 ⇒ 从子肢体近端端心沿中轴逐 1% 向内扫，取第一个在父子 alpha 内部的点。
#   ③ 余量 = min(该行 alpha 左右内缩距离, 该列 alpha 上下内缩距离)；
#      颈沿用 parts.json 的锚点（头是球形，重叠中心已对），但同样要过余量检查。
#
# 输出 src/data/limbAxes.json：skeleton.ts 消费 anchors；verify-core 钉住余量 ≥ 0。
# 跑法：python tools/measure-limb-axes.py
import json
import math
import os
import sys

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = r"C:\Users\22641\Desktop\游戏素材\ui页面\海猫_抠图"
OUT = os.path.join(ROOT, "src", "data", "limbAxes.json")
META_PATH = os.path.join(ROOT, "src", "data", "parts.json")

# 锚点距贴图轮廓的最小内缩（画布 px）。**分关节取值**：
#   · 肩/髋是大摆角球窝关节（肩 -95~80°、髋 -80~60°）⇒ 锚点必须**深**在肢体里，
#     否则摆出去时肢体上缘绕锚点扫出缝隙（源图里上臂顶只是一小撮 sliver，锚点贴边必露缝）。
#   · 肘/膝是链内铰链，摆角小、两侧贴图重叠很宽 ⇒ 6px 足够。
MARGIN_DEFAULT = 6.0   # 颈：球形头与躯干重叠很宽
MARGIN_HINGE = 8.0     # 肘：链内铰链
MARGIN_KNEE = 20.0     # 膝：见下面注释
# 膝：要求 20px（12.8mm）。用 4px 会把锚点顶在大腿贴图/胶囊的**端面**上 ——
#   实测越界 5.5mm（verify-core 报 10.9mm），而且膝一轉就露缝。
MARGIN_BALL = 25.0
BALL_JOINTS = ("shoulder_l", "shoulder_r", "hip_l", "hip_r")
KNEE_JOINTS = ("knee_l", "knee_r")
ELBOW_JOINTS = ("elbow_l", "elbow_r")
INWARD = 0.06       # 从近端端心沿中轴向内的比例（保证锚点严格在子贴图内部）
NEAR_PARALLEL = 0.02

FILES = {
    "arm_l": "猫的左臂.png",
    "arm_r": "猫的右臂.png",
    "hand_l": "猫的左手.png",
    "hand_r": "猫的右手.png",
    "thigh_l": "猫的左大腿.png",
    "thigh_r": "猫的右大腿.png",
    "shin_l": "猫的左小腿.png",
    "shin_r": "猫的右小腿.png",
    "torso": "猫的身体.png",
    "head": "猫的头.png",
}
# 关节：名字, 父刚体, 子刚体
CHAINS = [
    ("neck", "torso", "head"),
    ("shoulder_l", "torso", "arm_l"),
    ("shoulder_r", "torso", "arm_r"),
    ("elbow_l", "arm_l", "hand_l"),
    ("elbow_r", "arm_r", "hand_r"),
    ("hip_l", "torso", "thigh_l"),
    ("hip_r", "torso", "thigh_r"),
    ("knee_l", "thigh_l", "shin_l"),
    ("knee_r", "thigh_r", "shin_r"),
]


_MASK_CACHE = {}


def load_mask(path):
    """返回 (行区间 dict, 列区间 dict)。**带缓存**：全画布 4.6M 像素/部件，
    main + measure_paw + 骨轴重拟合会各要一次，不缓存要跑 3 分钟。"""
    if path in _MASK_CACHE:
        return _MASK_CACHE[path]
    r = _load_mask_uncached(path)
    _MASK_CACHE[path] = r
    return r


def _load_mask_uncached(path):
    im = Image.open(path).convert("RGBA")
    W, H = im.size
    a = im.load()
    rows, cols = {}, {}
    for y in range(H):
        for x in range(W):
            if a[x, y][3] > 8:
                if y in rows:
                    lo, hi = rows[y]
                    rows[y] = (min(lo, x), max(hi, x))
                else:
                    rows[y] = (x, x)
                if x in cols:
                    lo, hi = cols[x]
                    cols[x] = (min(lo, y), max(hi, y))
                else:
                    cols[x] = (y, y)
    return rows, cols


def margin_at(mask, x, y):
    """点 (x,y) 到 alpha 轮廓的内缩余量；不在内部返回负值。坐标取最近整数像素。"""
    x, y = int(round(x)), int(round(y))
    rows, cols = mask
    if y not in rows:
        return -1e9
    xlo, xhi = rows[y]
    if not (xlo <= x <= xhi):
        return -1e9
    if x not in cols:
        return -1e9
    ylo, yhi = cols[x]
    if not (ylo <= y <= yhi):
        return -1e9
    return min(x - xlo, xhi - x, y - ylo, yhi - y)


def row_profile(path):
    im = Image.open(path).convert("RGBA")
    W, H = im.size
    a = im.load()
    out = []
    for y in range(H):
        lo, hi, n, sx = None, None, 0, 0
        for x in range(W):
            if a[x, y][3] > 8:
                n += 1
                sx += x
                if lo is None:
                    lo = x
                hi = x
        if n > 3:
            out.append((y, sx / n, n))
    return out


def fit_axis(prof):
    sw = sy = syy = syk = sk = 0.0
    for y, xc, w in prof:
        sw += w
        sy += w * y
        syy += w * y * y
        syk += w * y * xc
        sk += w * xc
    det = sw * syy - sy * sy
    k = (sw * syk - sy * sk) / det
    b = (syy * sk - sy * syk) / det
    ss = 0.0
    for y, xc, w in prof:
        ss += w * (xc - (k * y + b)) ** 2
    return k, b, math.sqrt(ss / sw)


def axis_line(key):
    prof = row_profile(os.path.join(SRC_DIR, FILES[key]))
    k, b, rms = fit_axis(prof)
    y0, y1 = prof[0][0], prof[-1][0]
    return {"k": k, "b": b, "rms": rms, "y0": y0, "y1": y1,
            "proxTip": [prof[0][1], float(prof[0][0])],
            "distTip": [prof[-1][1], float(prof[-1][0])],
            "lenPx": y1 - y0}


def intersect(a, b):
    if abs(a["k"] - b["k"]) < 1e-9:
        return None
    y = (b["b"] - a["b"]) / (a["k"] - b["k"])
    return [a["k"] * y + a["b"], y]


def inward_point(ca, frac):
    """从近端端心沿中轴向内 frac·轴长（轴向"下"= +y）。"""
    d = math.sqrt(1 + ca["k"] ** 2)          # |dx/dy| = 1（拟合式 x=k·y+b）
    step = ca["lenPx"] * frac
    return [ca["proxTip"][0] + ca["k"] * step, ca["proxTip"][1] + step]


def topmost_overlap(pm, cm, tip, span, mg_min=MARGIN_DEFAULT):
    """父子 alpha 重叠区里**离 tip 最近的点**（逐行由上往下，取第一个够余量的）。

    解剖含义：肩 = 上臂与躯干"最初相接"处，髋 = 大腿与骨盆相接处，肘/膝同理。
    源图里右臂顶只与躯干重叠 1~2 px，沿中轴内扫永远落在躯干外 ⇒ 必须做二维搜索。
    """
    prows, crows = pm[0], cm[0]
    best = None
    y = int(round(tip[1]))
    y_end = y + int(span)
    while y <= y_end:
        pr, cr = prows.get(y), crows.get(y)
        if pr and cr:
            lo, hi = max(pr[0], cr[0]), min(pr[1], cr[1])
            if lo <= hi:
                # 在重叠区间里找"两侧余量都最大"的 x
                cand = max(range(lo, hi + 1),
                           key=lambda x: min(margin_at(pm, x, y), margin_at(cm, x, y)))
                mg = min(margin_at(pm, cand, y), margin_at(cm, cand, y))
                if best is None or mg > best[1]:
                    best = ([cand, y], mg)
                if mg >= mg_min:
                    return [cand, y], mg
        y += 1
    return best if best else (None, -1e9)


def best_overlap(pm, cm, box):
    """兜底：给定范围内取两侧余量最大的重叠点。"""
    x0, y0, x1, y1 = box
    best = None
    for y in range(int(y0), int(y1) + 1):
        pr, cr = pm[0].get(y), cm[0].get(y)
        if not (pr and cr):
            continue
        lo, hi = max(pr[0], cr[0], int(x0)), min(pr[1], cr[1], int(x1))
        if lo > hi:
            continue
        for x in range(lo, hi + 1):
            mg = min(margin_at(pm, x, y), margin_at(cm, x, y))
            if best is None or mg > best[2]:
                best = ([x, y], mg)
    return best if best else (None, -1e9)


def measure_paw(key):
    """量靴子（爪区）：用户回读"脚部和纹理不太匹配" ⇒ 脚掌碰撞盒也必须从纹理推。

    之前 `parts.json` 的 `sole` 是**手填常数**（len=343px/thick=82px），
    而且挂在小腿胶囊**正中**、侧向半宽取 `capsuleRadius·0.9` ⇒ 与画出来的靴子对不上。

    这里的定义（全部来自 alpha）：
      · 爪区 = 从**最宽行**（靴筒/脚背交界，画布上靴子最宽的那一行）到 alpha 最低点；
      · lateralHalf = 爪区所有行区间的并集 x 跨度的一半 ⇒ 靴子的侧向半宽；
      · centerX = 该跨度中点（靴子相对小腿中轴是**偏**的，要按它摆）；
      · soleLowY = alpha 最低点（画布 y）；
      · slopeDeg = 底边轮廓的斜率（只报告，不据此给碰撞体加横滚 ——
        双足角色必须平底接地，15~19° 的画布斜边更像"脚朝前外侧"的透视，不是真的侧倾）。
    """
    rows, cols = load_mask(os.path.join(SRC_DIR, FILES[key]))
    y_low = max(rows)
    widths = [(y, rows[y][1] - rows[y][0]) for y in range(y_low - 260, y_low + 1) if y in rows]
    y_wide = max(widths, key=lambda t: t[1])[0]
    lo_x = min(rows[y][0] for y in range(y_wide, y_low + 1) if y in rows)
    hi_x = max(rows[y][1] for y in range(y_wide, y_low + 1) if y in rows)
    # 底边轮廓斜率：对爪区内的列取最大 y，最小二乘
    pts = [(x, cols[x][1]) for x in range(lo_x, hi_x + 1, 4) if x in cols and cols[x][1] >= y_wide - 20]
    n = len(pts)
    if n >= 4:
        sx = sum(p[0] for p in pts); sy = sum(p[1] for p in pts)
        sxx = sum(p[0] * p[0] for p in pts); sxy = sum(p[0] * p[1] for p in pts)
        k = (n * sxy - sx * sy) / (n * sxx - sx * sx)
        slope = math.degrees(math.atan2(k, 1.0))
    else:
        slope = 0.0
    # ★ 骨轴（**只用靴子上方的小腿肚段**，靴子的外张会把整条轴带偏）外推到脚底高度。
    #   用户回读："从膝关节到脚尖，脚尖朝外侧" —— 画出来的靴心比骨轴外偏 20~23mm，
    #   那段外偏**就是素材里的外八**。脚掌 collider 要按骨轴摆，纹理保持原样。
    prof = row_profile(os.path.join(SRC_DIR, FILES[key]))
    shaft = [p for p in prof if p[0] <= y_wide]
    k, b, _ = fit_axis(shaft)
    sole_mid_y = y_low - 41          # 盒心所在画布 y（= 靴底再上 sole.thick/2）
    return {
        "yWide": y_wide, "yLow": y_low,
        "centerX": round((lo_x + hi_x) / 2, 1),
        "drawnAxisXAtSole": round(k * sole_mid_y + b, 1),
        "shaftTiltDeg": round(math.degrees(math.atan2(k, 1.0)), 2),
        "lateralHalf": round((hi_x - lo_x) / 2, 1),
        "pawHeightPx": y_low - y_wide,
        "slopeDeg": round(slope, 2),
    }


def on_child_axis(ca, pm, cm, mg_min):
    """锚点落在**子骨骼轴**上、且仍在父子 alpha 内部的最深一点（y 最大 = 最靠远端）。

    为什么需要：站姿修正后小腿骨轴是**铅垂线**，而素材画的小腿是外撇的
    ⇒ 用"两轴求交/最近可交点"算出的膝会偏离骨轴 20~30mm，
    铰链不在骨头上 ⇒ 一转腿就"拧"。这条规则把锚点吸回骨轴。
    """
    x_axis = ca["b"]
    best = None
    for y in range(int(ca["y0"]), int(ca["y1"]) + 1):
        pr, cr = pm[0].get(y), cm[0].get(y)
        if not (pr and cr):
            continue
        if not (pr[0] <= x_axis <= pr[1] and cr[0] <= x_axis <= cr[1]):
            continue
        mg = min(margin_at(pm, x_axis, y), margin_at(cm, x_axis, y))
        if mg < mg_min:
            continue
        if best is None or y > best[0][1]:
            best = ([round(x_axis, 1), float(y)], mg)
    return best if best else (None, -1e9)


def weighted_mid_cross(pa, ca, pm, cm, mg_min, r_pa, r_ca, y_hint):
    """两条铅垂骨轴之间的**加权中点**（肘用）。

    站姿修正后上臂骨与前臂骨都是竖直的，但它们各自的 x 差 ~150px（上臂 407 / 前臂 250），
    所以肘锚点不可能同时在两根骨头上。而 Rapier 的球关节锚点必须落在**两个刚体的碰撞体内**，
    否则一 reset 就被弹开（verify-core 的"锚点不越出胶囊"就是这条）。
    ⇒ 取 x = (x_pa·r_ca + x_ca·r_pa)/(r_pa + r_ca)（按对侧胶囊半径加权 = 落在两者都容得下的位置），
      再要求该 x 距两条骨轴都 ≤ 对应胶囊半径，并落在父子 alpha 内。
    半径取 `capsuleFromBox` 的口径：r = 0.3·bbox 宽（limbRadiusScale=0.6）。
    """
    x_pa = pa["b"]
    x_ca = ca["b"]
    x = (x_pa * r_ca + x_ca * r_pa) / (r_pa + r_ca)
    if abs(x - x_pa) > r_pa or abs(x - x_ca) > r_ca:
        return None, -1e9
    best = None
    y_lo = max(pa["y0"], ca["y0"], y_hint - 120)
    y_hi = min(pa["y1"], ca["y1"], y_hint + 120)
    for y in range(int(y_lo), int(y_hi) + 1):
        pr, cr = pm[0].get(y), cm[0].get(y)
        if not (pr and cr):
            continue
        xx = min(max(x, max(pr[0], cr[0])), min(pr[1], cr[1]))
        mg = min(margin_at(pm, xx, y), margin_at(cm, xx, y))
        if mg < mg_min:
            continue
        d = abs(y - y_hint)
        if best is None or d < best[2]:
            best = ([round(xx, 1), float(y)], mg, d)
    return (best[0], best[1]) if best else (None, -1e9)


def nearest_cross(pa, ca, pm, cm, mg_min):
    """双骨轴**最近的可交点**（严格求交常常落到某侧贴图之外 ⇒ 不可用）。

    逐行：在两张贴图 alpha 都覆盖、且到两侧轮廓余量都 ≥ mg_min 的行里，
    取"两轴横向差最小"的那一行，x 取两轴的中点（并夹进该行 alpha 重叠区间）。
    解剖含义：铰链就在两根骨轴贴得最近处 —— 严格交点越界时它是唯一稳定的定义。
    """
    prows, crows = pm[0], cm[0]
    y_lo = max(pa["y0"], ca["y0"])
    y_hi = min(pa["y1"], ca["y1"])
    best = None
    for y in range(int(y_lo), int(y_hi) + 1):
        pr, cr = prows.get(y), crows.get(y)
        if not (pr and cr):
            continue
        lo, hi = max(pr[0], cr[0]), min(pr[1], cr[1])
        if lo > hi:
            continue
        xp = pa["k"] * y + pa["b"]
        xc = ca["k"] * y + ca["b"]
        x = min(max((xp + xc) / 2, lo), hi)
        mg = min(margin_at(pm, x, y), margin_at(cm, x, y))
        if mg < mg_min:
            continue
        mis = abs(xp - xc)
        if best is None or mis < best[2]:
            best = ([round(x, 1), float(y)], mg, mis)
    return best if best else (None, -1e9, 1e9)


# ---------------------------------------------------------------- 左右对称化
# 源图**左右不等**（用户回读："有一个大腿是侧偏的"）：肩锚点 y 664 vs 743（差 79px）、
# 髋 z 差 35mm、大腿长 0.429 vs 0.443m、脚掌侧向半宽 165 vs 153px。
# 骨架**必须对称**，否则平衡/步态/适应度全带偏 ⇒ 逐对做**镜像平均**：
#   x_sym = 画布中线 − (|x_L − 中线| + |x_R − 中线|)/2，y 取两侧平均。
# 纹理仍然按素材原位摆（用户："纹理是不能动的，要动骨骼"），
# 于是每侧纹理与骨骼之间留一个**对称**的残差 —— 这就是骨架该有的样子。
PAIRS = [("shoulder_l", "shoulder_r"), ("elbow_l", "elbow_r"),
         ("hip_l", "hip_r"), ("knee_l", "knee_r")]
PART_PAIRS = [("arm_l", "arm_r"), ("hand_l", "hand_r"),
              ("thigh_l", "thigh_r"), ("shin_l", "shin_r")]


AXES_ANCHOR_HINT = {j["name"]: (j["x"], j["y"]) for j in json.load(
    open(os.path.join(ROOT, "src", "data", "parts.json"), encoding="utf-8"))["joints"]}


def symmetrize_axes(axes, center_x):
    """骨轴左右对称化（最小镜像平移，**绝不**用端点质心重拟合）。"""
    print("\n骨轴左右对称化（骨架必须对称；纹理保持原位）：")
    for l, r in PART_PAIRS:
        al, ar = axes[l], axes[r]
        # ① 斜率：取两侧绝对值平均，符号按侧
        kk = round((abs(al["k"]) + abs(ar["k"])) / 2, 5)
        # ② 位置对称：在**肢体中点高度** y_ref 上做镜像平移（而不是交换截距 b）。
        #    截距 b 对斜率极敏感（前臂 k≈0.61、轴长 650px，斜率差 0.04 就让 b 差 25px），
        #    拿 b 做镜像会把整条肢体搬走；用中点处的 x 做镜像平移是条件数最好的写法。
        y_ref = round((al["y0"] + al["y1"] + ar["y0"] + ar["y1"]) / 4, 1)
        xl = al["k"] * y_ref + al["b"]
        xr = ar["k"] * y_ref + ar["b"]
        x_ref = center_x - (abs(xl - center_x) + abs(xr - center_x)) / 2
        for key, k, x_want in ((l, -kk, x_ref), (r, kk, 2 * center_x - x_ref)):
            axes[key]["k"] = k
            axes[key]["b"] = round(x_want - k * y_ref, 2)
        # ③ 端点：y 取两侧平均（左右肢段长度不等 ⇒ 中心高度也要对称），x 由骨轴反算
        for f in ("y0", "y1"):
            v = round((al[f] + ar[f]) / 2, 1)
            axes[l][f] = v
            axes[r][f] = v
        for key in (l, r):
            a = axes[key]
            a["proxTip"] = [round(a["k"] * a["y0"] + a["b"], 1), float(a["y0"])]
            a["distTip"] = [round(a["k"] * a["y1"] + a["b"], 1), float(a["y1"])]
            a["lenPx"] = round(a["y1"] - a["y0"], 1)
        print(f"  {l[:-2]:6} k {axes[l]['k']:+.4f}/{axes[r]['k']:+.4f}"
              f"  中点高y={y_ref:6.1f} 处 x {xl:7.1f}/{xr:7.1f} → {x_ref:7.1f}"
              f"  位移 {(x_ref - xl):+6.1f}/{(2 * center_x - x_ref - xr):+6.1f} px")


def symmetrize_anchors(anchors, center_x):
    """关节锚点左右对称化：源图左右不等 ⇒ 锚点必须对称，否则腿是歪的。"""
    print("\n锚点左右对称化：")
    for l, r in PAIRS:
        if l not in anchors or r not in anchors:
            continue
        lx, ly = anchors[l]
        rx, ry = anchors[r]
        x = center_x - (abs(lx - center_x) + abs(rx - center_x)) / 2
        y = (ly + ry) / 2
        print(f"  {l[:-2]:6} x {lx:7.1f}/{rx:7.1f} → {x:7.1f}   y {ly:6.1f}/{ry:6.1f} → {y:6.1f}")
        anchors[l] = [round(x, 1), round(y, 1)]
        anchors[r] = [round(2 * center_x - x, 1), round(y, 1)]


def main() -> int:
    meta = json.load(open(META_PATH, encoding="utf-8"))
    parts = {p["key"]: p for p in meta["parts"]}
    old_anchor = {j["name"]: (j["x"], j["y"]) for j in meta["joints"]}
    axes = {k: axis_line(k) for k in FILES}
    masks = {k: load_mask(os.path.join(SRC_DIR, FILES[k])) for k in FILES}

    # ★★ 小腿骨轴 —— 两处修正，都是"骨骼"层面的，纹理一律不动：
    #   ① 先只用**靴子上方的小腿肚段**拟合：靴子外张 20~23mm，会把整条小腿轴带偏 3°
    #      （全高拟合 8~9° → 靴上方拟合 4.9~5.5°）。
    #   ② 再把骨轴改成**铅垂**（k=0，过该肢体中段中点）：上臂/前臂/小腿都竖直。
    #      用户回读"脚尖朝外侧"——素材整条腿外撇（髋 615 → 膝 542 → 脚底 476px），
    #      照搬骨骼就是外八。改成垂直后"膝→脚尖"是一条铅垂线（用户："从膝关节到脚尖"）。
    #   上肢同样处理（用户："我要手臂侧面的骨架竖直，纹理别动"）——
    #   原来上臂骨 5°、前臂骨 31°，肘几乎伸直却在骨上折 36° = 一条断臂。
    #   纹理侧完全不受影响：倾角在渲染端被 restVisualQuatOf 补偿掉，贴图仍与素材逐像素一致。
    for key in ("shin_l", "shin_r", "arm_l", "arm_r", "hand_l", "hand_r"):
        prof = row_profile(os.path.join(SRC_DIR, FILES[key]))
        if key.startswith("shin"):
            shaft = [p for p in prof if p[0] <= measure_paw(key)["yWide"]]   # 排除靴子
        else:
            shaft = prof                                                      # 上肢整条
        k, b, rms = fit_axis(shaft)
        y0, y1 = shaft[0][0], shaft[-1][0]
        x_mid = k * ((y0 + y1) / 2) + b
        axes[key] = {
            "k": 0.0, "b": x_mid, "rms": rms, "y0": y0, "y1": y1,
            "proxTip": [x_mid, float(y0)],
            "distTip": [x_mid, float(y1)],
            "lenPx": y1 - y0,
            "drawnTiltDeg": round(math.degrees(math.atan2(k, 1.0)), 2),
        }

    # ★ 先对称化骨轴，**再**用对称后的骨轴找锚点（否则锚点吸附在各自歪掉的骨轴上）
    center_x = (meta["extent"]["x0"] + meta["extent"]["x1"]) / 2
    symmetrize_axes(axes, center_x)

    paws = {"l": measure_paw("shin_l"), "r": measure_paw("shin_r")}
    # 爪区对称化：**位置类**字段做镜像平均；**尺寸类**字段（半宽/高度）只能取算术平均
    for f in ("centerX", "drawnAxisXAtSole", "axisXAtSole"):
        if f not in paws["l"]:
            continue
        lv, rv = paws["l"][f], paws["r"][f]
        v = center_x - (abs(lv - center_x) + abs(rv - center_x)) / 2
        paws["l"][f] = round(v, 1)
        paws["r"][f] = round(2 * center_x - v, 1)
    for f in ("lateralHalf", "pawHeightPx", "yWide", "yLow"):
        paws["l"][f] = round((paws["l"][f] + paws["r"][f]) / 2, 1)
        paws["r"][f] = paws["l"][f]
    paws["l"]["slopeDeg"] = round(-(paws["l"]["slopeDeg"] + paws["r"]["slopeDeg"]) / 2, 2)
    paws["r"]["slopeDeg"] = -paws["l"]["slopeDeg"]
    print("\n爪区（靴子）实测 —— 脚掌碰撞盒按它摆，不再用手填常数：")
    for side, p in paws.items():
        print(f"  shin_{side}: 最宽行 y={p['yWide']}  最低点 y={p['yLow']}  爪高 {p['pawHeightPx']}px  "
              f"中心 x={p['centerX']}  侧向半宽 {p['lateralHalf']}px  底边斜 {p['slopeDeg']}°")

    symmetrize_anchors(anchors, center_x)

    out = {
        "_comment": "肢体中轴 + 关节锚点 + 爪区实测（画布 px，源图坐标）。tools/measure-limb-axes.py 生成。"
                    "锚点已保证落在父/子贴图 alpha 内部（margin 字段）⇒ 关节连得上；"
                    "skeleton.ts 消费 anchors/paw；verify-core 钉住 margin ≥ 0。",
        "source": SRC_DIR,
        "scale": meta.get("scale", 0.5),
        "axes": {k: {"k": round(v["k"], 5), "b": round(v["b"], 2), "rms": round(v["rms"], 2),
                     "tiltDeg": round(math.degrees(math.atan2(v["k"], 1.0)), 2),
                     "proxTip": [round(v["proxTip"][0], 1), round(v["proxTip"][1], 1)],
                     "distTip": [round(v["distTip"][0], 1), round(v["distTip"][1], 1)],
                     "lenPx": round(v["lenPx"], 1)}
                 for k, v in axes.items()},
        "anchors": anchors,
        "margin": margins,
        "paw": paws,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\n写入 {OUT}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
