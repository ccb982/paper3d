// src/data/parts.json
var parts_default = {
  generator: "tools/build-parts.py",
  source: "C:\\Users\\22641\\Desktop\\\u6E38\u620F\u7D20\u6750\\ui\u9875\u9762\\\u6D77\u732B_\u62A0\u56FE",
  canvas: {
    w: 1568,
    h: 2944
  },
  scale: 0.5,
  extent: {
    x0: 13,
    y0: 92,
    x1: 1552,
    y1: 2899,
    w: 1539,
    h: 2807
  },
  parts: [
    {
      key: "shin_l",
      label: "\u5DE6\u5C0F\u817F",
      bone: "shinL",
      z: 10,
      file: "parts/shin_l.webp",
      w: 186,
      h: 408,
      bytes: 11458,
      cx: 461.5,
      cy: 2484.5,
      bw: 373,
      bh: 817
    },
    {
      key: "shin_r",
      label: "\u53F3\u5C0F\u817F",
      bone: "shinR",
      z: 11,
      file: "parts/shin_r.webp",
      w: 175,
      h: 437,
      bytes: 12302,
      cx: 1075,
      cy: 2462,
      bw: 350,
      bh: 874
    },
    {
      key: "thigh_l",
      label: "\u5DE6\u5927\u817F",
      bone: "thighL",
      z: 20,
      file: "parts/thigh_l.webp",
      w: 178,
      h: 334,
      bytes: 8428,
      cx: 620.5,
      cy: 1884.5,
      bw: 357,
      bh: 669
    },
    {
      key: "thigh_r",
      label: "\u53F3\u5927\u817F",
      bone: "thighR",
      z: 21,
      file: "parts/thigh_r.webp",
      w: 187,
      h: 346,
      bytes: 8960,
      cx: 931,
      cy: 1894.5,
      bw: 374,
      bh: 691
    },
    {
      key: "torso",
      label: "\u8EAB\u4F53",
      bone: "torso",
      z: 30,
      file: "parts/torso.webp",
      w: 353,
      h: 628,
      bytes: 30216,
      cx: 772,
      cy: 1140.5,
      bw: 706,
      bh: 1255
    },
    {
      key: "arm_l",
      label: "\u5DE6\u81C2",
      bone: "armL",
      z: 40,
      file: "parts/arm_l.webp",
      w: 124,
      h: 298,
      bytes: 9268,
      cx: 399.5,
      cy: 922.5,
      bw: 247,
      bh: 595
    },
    {
      key: "arm_r",
      label: "\u53F3\u81C2",
      bone: "armR",
      z: 41,
      file: "parts/arm_r.webp",
      w: 112,
      h: 246,
      bytes: 7932,
      cx: 1127.5,
      cy: 936,
      bw: 223,
      bh: 492
    },
    {
      key: "hand_l",
      label: "\u5DE6\u624B",
      bone: "handL",
      z: 50,
      file: "parts/hand_l.webp",
      w: 238,
      h: 328,
      bytes: 15240,
      cx: 251.5,
      cy: 1370,
      bw: 477,
      bh: 656
    },
    {
      key: "hand_r",
      label: "\u53F3\u624B",
      bone: "handR",
      z: 51,
      file: "parts/hand_r.webp",
      w: 234,
      h: 308,
      bytes: 14706,
      cx: 1317.5,
      cy: 1392,
      bw: 469,
      bh: 616
    },
    {
      key: "head",
      label: "\u5934",
      bone: "head",
      z: 60,
      file: "parts/head.webp",
      w: 179,
      h: 320,
      bytes: 13014,
      cx: 792,
      cy: 412,
      bw: 358,
      bh: 640
    }
  ],
  joints: [
    {
      name: "neck",
      parent: "torso",
      child: "head",
      x: 792,
      y: 622.5,
      limitDeg: [
        -35,
        45
      ]
    },
    {
      name: "shoulder_l",
      parent: "torso",
      child: "arm_l",
      x: 471,
      y: 922.5,
      limitDeg: [
        -95,
        80
      ]
    },
    {
      name: "shoulder_r",
      parent: "torso",
      child: "arm_r",
      x: 1070.5,
      y: 936,
      limitDeg: [
        -95,
        80
      ]
    },
    {
      name: "elbow_l",
      parent: "arm_l",
      child: "hand_l",
      x: 383,
      y: 1131,
      limitDeg: [
        -120,
        10
      ]
    },
    {
      name: "elbow_r",
      parent: "arm_r",
      child: "hand_r",
      x: 1161,
      y: 1133,
      limitDeg: [
        -120,
        10
      ]
    },
    {
      name: "hip_l",
      parent: "torso",
      child: "thigh_l",
      x: 620.5,
      y: 1659,
      limitDeg: [
        -80,
        60
      ]
    },
    {
      name: "hip_r",
      parent: "torso",
      child: "thigh_r",
      x: 931,
      y: 1658.5,
      limitDeg: [
        -80,
        60
      ]
    },
    {
      name: "knee_l",
      parent: "thigh_l",
      child: "shin_l",
      x: 545,
      y: 2147.5,
      limitDeg: [
        -145,
        2
      ]
    },
    {
      name: "knee_r",
      parent: "thigh_r",
      child: "shin_r",
      x: 1009,
      y: 2132.5,
      limitDeg: [
        -145,
        2
      ]
    }
  ],
  sole: {
    len: 343.14,
    thick: 81.7,
    massPercent: 1.45
  },
  bytesTotal: 131524
};

// src/data/limbAxes.json
var limbAxes_default = {
  _comment: "\u80A2\u4F53\u4E2D\u8F74 + \u5173\u8282\u951A\u70B9 + \u722A\u533A\u5B9E\u6D4B\uFF08\u753B\u5E03 px\uFF0C\u6E90\u56FE\u5750\u6807\uFF09\u3002tools/measure-limb-axes.py \u751F\u6210\u3002\u951A\u70B9\u5DF2\u4FDD\u8BC1\u843D\u5728\u7236/\u5B50\u8D34\u56FE alpha \u5185\u90E8\uFF08margin \u5B57\u6BB5\uFF09\u21D2 \u5173\u8282\u8FDE\u5F97\u4E0A\uFF1Bskeleton.ts \u6D88\u8D39 anchors/paw\uFF1Bverify-core \u9489\u4F4F margin \u2265 0\u3002",
  source: "C:\\Users\\22641\\Desktop\\\u6E38\u620F\u7D20\u6750\\ui\u9875\u9762\\\u6D77\u732B_\u62A0\u56FE",
  scale: 0.5,
  axes: {
    arm_l: {
      k: -0.08834,
      b: 514.62,
      rms: 11.13,
      tiltDeg: -5.05,
      proxTip: [
        456.5,
        658
      ],
      distTip: [
        408.7,
        1199.5
      ],
      lenPx: 541.5
    },
    arm_r: {
      k: 0.08834,
      b: 1050.38,
      rms: 6.92,
      tiltDeg: 5.05,
      proxTip: [
        1108.5,
        658
      ],
      distTip: [
        1156.3,
        1199.5
      ],
      lenPx: 541.5
    },
    hand_l: {
      k: -0.60768,
      b: 1089.66,
      rms: 24.08,
      tiltDeg: -31.29,
      proxTip: [
        443.4,
        1063.5
      ],
      distTip: [
        57.8,
        1698
      ],
      lenPx: 634.5
    },
    hand_r: {
      k: 0.60768,
      b: 475.34,
      rms: 23.22,
      tiltDeg: 31.29,
      proxTip: [
        1121.6,
        1063.5
      ],
      distTip: [
        1507.2,
        1698
      ],
      lenPx: 634.5
    },
    thigh_l: {
      k: -0.14031,
      b: 862.02,
      rms: 4.7,
      tiltDeg: -7.99,
      proxTip: [
        644.6,
        1549.5
      ],
      distTip: [
        549.3,
        2228.5
      ],
      lenPx: 679
    },
    thigh_r: {
      k: 0.14031,
      b: 702.98,
      rms: 11.02,
      tiltDeg: 7.99,
      proxTip: [
        920.4,
        1549.5
      ],
      distTip: [
        1015.7,
        2228.5
      ],
      lenPx: 679
    },
    shin_l: {
      k: -0,
      b: 527.46,
      rms: 10.05,
      tiltDeg: -0,
      proxTip: [
        527.5,
        2051.5
      ],
      distTip: [
        527.5,
        2792
      ],
      lenPx: 740.5
    },
    shin_r: {
      k: 0,
      b: 1037.54,
      rms: 9.06,
      tiltDeg: 0,
      proxTip: [
        1037.5,
        2051.5
      ],
      distTip: [
        1037.5,
        2792
      ],
      lenPx: 740.5
    },
    torso: {
      k: -0.0135,
      b: 787.96,
      rms: 6.73,
      tiltDeg: -0.77,
      proxTip: [
        783.5,
        513
      ],
      distTip: [
        874.5,
        1767
      ],
      lenPx: 1254
    },
    head: {
      k: -0.01059,
      b: 791.21,
      rms: 4.7,
      tiltDeg: -0.61,
      proxTip: [
        796,
        92
      ],
      distTip: [
        775,
        731
      ],
      lenPx: 639
    }
  },
  anchors: {
    neck: [
      792,
      622.5
    ],
    shoulder_l: [
      479,
      703.5
    ],
    shoulder_r: [
      1086,
      703.5
    ],
    elbow_l: [
      416.9,
      1107
    ],
    elbow_r: [
      1148.1,
      1107
    ],
    hip_l: [
      587.5,
      1574.5
    ],
    hip_r: [
      977.5,
      1574.5
    ],
    knee_l: [
      527.5,
      2206
    ],
    knee_r: [
      1037.5,
      2206
    ],
    foot_l: [
      454.5,
      2792
    ],
    foot_r: [
      1110.5,
      2792
    ]
  },
  margin: {
    neck: 99,
    shoulder_l: 25,
    shoulder_r: 25,
    elbow_l: 32,
    elbow_r: 18,
    hip_l: 25,
    hip_r: 25,
    knee_l: 20,
    knee_r: 20
  },
  paw: {
    l: {
      yWide: 2792,
      yLow: 2895,
      centerX: 454.5,
      drawnAxisXAtSole: 488.1,
      shaftTiltDeg: -5.54,
      lateralHalf: 159,
      pawHeightPx: 103,
      slopeDeg: -0.82
    },
    r: {
      yWide: 2792,
      yLow: 2895,
      centerX: 1110.5,
      drawnAxisXAtSole: 1076.9,
      shaftTiltDeg: 4.88,
      lateralHalf: 159,
      pawHeightPx: 103,
      slopeDeg: 0.82
    }
  },
  anchorsNote: "foot_l/foot_r = \u8E1D\u951A\u70B9\uFF1Ay \u53D6 paw.yWide\uFF08\u9774\u5B50\u9876\u7AEF\uFF0C\u5B9E\u6D4B 2792\uFF09\uFF0Cx \u53D6 paw.centerX\uFF08\u5B9E\u6D4B\u9774\u5FC3\uFF09\u30022026-10-01 \u52A0\u8E1D\u5173\u8282\u65F6\u52A0\u5165\u3002"
};

// src/core/partsMeta.ts
var ANKLE_JOINTS = [
  { name: "foot_l", parent: "shin_l", child: "foot_l", x: 454.5, y: 2792, limitDeg: [-10, 18] },
  { name: "foot_r", parent: "shin_r", child: "foot_r", x: 1110.5, y: 2792, limitDeg: [-10, 18] }
];
var HIP_LIMIT = [-95, 100];
var meta = parts_default;
for (const j of meta.joints) {
  if (j.name === "hip_l" || j.name === "hip_r") j.limitDeg = [HIP_LIMIT[0], HIP_LIMIT[1]];
}
if (!meta.joints.some((j) => j.name === "foot_l")) meta.joints.push(...ANKLE_JOINTS);
var META = meta;
var PART_BY_KEY = new Map(
  META.parts.map((p) => [p.key, p])
);
var LIMB_AXES = limbAxes_default;

// src/core/skeleton.ts
function restQuatOf(tiltRad, yawRad) {
  const ht = tiltRad / 2, hy = yawRad / 2;
  return [
    Math.cos(hy) * Math.sin(ht),
    Math.sin(hy) * Math.cos(ht),
    -Math.sin(hy) * Math.sin(ht),
    Math.cos(hy) * Math.cos(ht)
  ];
}
function restVisualQuatOf(tiltRad) {
  return restQuatOf(tiltRad, 0);
}
function invQuatOf(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}
function quatToRotVec(q) {
  const w = q[3] > 1 ? 1 : q[3] < -1 ? -1 : q[3];
  const half = Math.acos(w);
  const s = Math.sin(half);
  if (Math.abs(s) < 1e-7) return [0, 0, 0];
  const ang = 2 * half;
  const k = ang > Math.PI ? -(2 * Math.PI - ang) / s : ang / s;
  return [q[0] * k, q[1] * k, q[2] * k];
}
function quatRel(a, b) {
  const cx = -a[0], cy2 = -a[1], cz2 = -a[2], cw = a[3];
  return [
    cw * b[0] + cx * b[3] + cy2 * b[2] - cz2 * b[1],
    cw * b[1] - cx * b[2] + cy2 * b[3] + cz2 * b[0],
    cw * b[2] + cx * b[1] - cy2 * b[0] + cz2 * b[3],
    cw * b[3] - cx * b[0] - cy2 * b[1] - cz2 * b[2]
  ];
}
function rotVecByQuat(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx)
  ];
}
var DEFAULT_CONFIG = {
  height: 1.8,
  mass: 70,
  // ★ 2D 时代用 0.5 是为了在**同一个平面内**减少双腿互穿；3D 之后双腿分开在 Z 上，
  //   再并拢反而让两个大腿胶囊（半径 6.9cm、间距 10cm）重叠。取 1.0 = 素材原样的
  //   自然站姿宽度（大腿中心间距 ≈ 0.20m）。
  stance: 1,
  limbRadiusScale: 0.6,
  // 4 段 ⇒ 骨盆 + 3 节脊椎（腰-胸-颈），脊柱关节 3 个，转动自由度 36。
  // 段数不宜再多：每段都要有独立质量与惯量，切太细 ES 的搜索空间会爆炸（且小段的
  // 惯量趋近于 0，正是 probe-motor 里那种"数值爆炸"的温床）。
  spineSegments: 4,
  legStretch: 0.02,
  /**
   * ★ 踝（跖屈肌）力矩上限 N·m。**A 方案的核心参数。**
   *   文献依据：人类跖屈肌 MVC ~120~140 N·m；
   *   Neptune/Perry, Front Neurol 2019, 10:999 —— 跖屈肌是 CoM 推进的**主引擎**，
   *   "the work produced by these muscles has been **four times more efficient** than
   *    the work produced by the hip muscles to sustain the CoM increment during
   *    the single-stance period"。
   *   为什么必须抬：把 CoP 从脚底中心推到脚尖需要 ≈ 体重 × 足半长 ≈ 30×9.81×0.10 ≈ 29 N·m，
   *   推到边缘 ≈ 35 N·m。原来的 45 N·m 名义上够，但实测只用到声明值的 18~28%
   *   ⇒ 踝力矩对动力学**零效力**，CoP 移不动 ⇒ 承重转移无法发生。
   *   留空/默认 = JOINT_MAX_TORQUE 的 45（探针按此档扫描）。
   */
  //   legStretch=0.02 由 probe-arch 扫描定值：终 CoM +0.048（其余档 −0.25~−0.66）、离地峰 103mm
  soleFootScale: 1,
  // ★★ 脚掌外八 25°（用户定调："脚要向外侧倾斜，做成外八"，随后"再向外一点"）。
  //   脚掌盒的**横向位置**仍按膝锚点摆（膝到脚尖铅垂），外八只改脚尖的朝向。
  footSplayDeg: 25,
  // 踝：低头 25°（蹬地/尖脚）… 勾脚 20°（脚跟先着地）。保守取值，避免刚体互穿。
  anklePitchDeg: [0, 0],
  ankleRollDeg: 0,
  ankleTorque: 45,
  footUvWarpDeg: 0,
  ankleEnabled: false
};
var SEGMENTS = [
  { key: "head", bone: "head", label: "\u5934", massPct: 8.1, comRatio: 0.495, gyrationRatio: 0.495, proximal: "bottom" },
  { key: "torso", bone: "torso", label: "\u8EAF\u5E72", massPct: 49.7, comRatio: 0.495, gyrationRatio: 0.406, proximal: "bottom" },
  { key: "arm_l", bone: "armL", label: "\u5DE6\u4E0A\u81C2", massPct: 2.8, comRatio: 0.436, gyrationRatio: 0.322, proximal: "top" },
  { key: "arm_r", bone: "armR", label: "\u53F3\u4E0A\u81C2", massPct: 2.8, comRatio: 0.436, gyrationRatio: 0.322, proximal: "top" },
  { key: "hand_l", bone: "handL", label: "\u5DE6\u524D\u81C2", massPct: 2.2, comRatio: 0.682, gyrationRatio: 0.468, proximal: "top" },
  { key: "hand_r", bone: "handR", label: "\u53F3\u524D\u81C2", massPct: 2.2, comRatio: 0.682, gyrationRatio: 0.468, proximal: "top" },
  { key: "thigh_l", bone: "thighL", label: "\u5DE6\u5927\u817F", massPct: 10, comRatio: 0.433, gyrationRatio: 0.323, proximal: "top", leg: true },
  { key: "thigh_r", bone: "thighR", label: "\u53F3\u5927\u817F", massPct: 10, comRatio: 0.433, gyrationRatio: 0.323, proximal: "top", leg: true },
  { key: "shin_l", bone: "shinL", label: "\u5DE6\u5C0F\u817F", massPct: 6.1, comRatio: 0.433, gyrationRatio: 0.302, proximal: "top", leg: true, soleMassPct: 1.45 },
  { key: "shin_r", bone: "shinR", label: "\u53F3\u5C0F\u817F", massPct: 6.1, comRatio: 0.433, gyrationRatio: 0.302, proximal: "top", leg: true, soleMassPct: 1.45 }
];
var JOINT_ORDER = [
  "neck",
  "shoulder_l",
  "shoulder_r",
  "elbow_l",
  "elbow_r",
  "hip_l",
  "hip_r",
  "knee_l",
  "knee_r",
  // ★ 踝（2026-10-01 新增）：脚掌是独立刚体，这两项是它的俯仰/内外翻。
  //   放在最后 ⇒ 已有的 0~7 号马达索引不变（旧基因组的权重仍对得上前 8 个关节）。
  "foot_l",
  "foot_r"
];
function anchorPx(name, jm) {
  const a = LIMB_AXES.anchors[name];
  return a ? [a[0], a[1]] : [jm.x, jm.y];
}
var JOINT_MAX_TORQUE = {
  neck: 100,
  shoulder_l: 100,
  shoulder_r: 100,
  elbow_l: 40,
  elbow_r: 40,
  hip_l: 200,
  hip_r: 200,
  knee_l: 150,
  knee_r: 150,
  // ★ 踝：比膝小一个量级（踝在人类身上本来就只有膝的 1/5~1/4 力矩），
  //   45 N·m 足够做"勾脚/尖脚"，太大反而会让脚像弹簧一样抽。
  foot_l: 45,
  // ★ 会被 cfg.ankleMaxTorque 覆盖
  foot_r: 45
};
var TORQUE_AXIS_FACTOR = [0.6, 0.35, 1];
var JOINT_LIMITS_XY_DEG = {
  neck: [30, 70],
  shoulder_l: [75, 65],
  shoulder_r: [75, 65],
  elbow_l: [14, 16],
  elbow_r: [14, 16],
  hip_l: [45, 40],
  hip_r: [45, 40],
  knee_l: [6, 8],
  knee_r: [6, 8],
  // 踝：X/Y（外展·内外翻）只给 ±8°，踝的侧向自由度不是走路的主自由度，
  //   放开会让脚掌乱翻、把支撑面搞丢。
  foot_l: [8, 6],
  foot_r: [8, 6]
};
var DEG = Math.PI / 180;
function capsuleFromBox(w, h, radiusScale) {
  const length = Math.max(w, h);
  const radius = Math.min(Math.min(w, h) / 2 * radiusScale, length / 2 * 0.92);
  return { length, radius, halfHeight: Math.max(0, length / 2 - radius) };
}
function comOffset(length, comRatio, proximal) {
  return proximal === "top" ? length * (0.5 - comRatio) : length * (comRatio - 0.5);
}
function buildSkeleton(cfg = DEFAULT_CONFIG) {
  const { extent } = META;
  const px2m = cfg.height / extent.h;
  const centerPx = (extent.x0 + extent.x1) / 2;
  const groundPx = extent.y1;
  const mapZ = (px, applyStance) => -(px - centerPx) * px2m * (applyStance ? cfg.stance : 1);
  const mapY = (px) => (groundPx - px) * px2m;
  const legKeys = new Set(SEGMENTS.filter((s) => s.leg).map((s) => s.key));
  const K = Math.max(1, Math.floor(cfg.spineSegments));
  const CHEST = K > 1 ? `spine${K}` : "torso";
  const segKey = (s) => s === 0 ? "torso" : `spine${s + 1}`;
  let byKeyRef = null;
  const attachTo = (parentKey, wy) => {
    if (parentKey !== "torso" || K <= 1 || !byKeyRef) return parentKey;
    let best = 0, bestD = Infinity;
    for (let s = 0; s < K; s++) {
      const b = byKeyRef.get(segKey(s));
      if (!b) continue;
      const d = Math.abs(b.cy - wy);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return segKey(best);
  };
  const soleHalfLen = META.sole.len * px2m / 2;
  const soleHalfThick = META.sole.thick * px2m / 2;
  const SOLE_GROUND_CORR = 0;
  const PIVOT_PAD = 0.015;
  const TILTED = /* @__PURE__ */ new Set(["arm_l", "arm_r", "hand_l", "hand_r", "thigh_l", "thigh_r", "shin_l", "shin_r"]);
  const restTiltOf = (key, leg) => {
    if (!TILTED.has(key)) return 0;
    if (key === "shin_l" || key === "shin_r") return 0;
    const ax = LIMB_AXES.axes[key];
    if (!ax) return 0;
    return Math.atan(ax.k * (leg ? cfg.stance : 1));
  };
  const restYawOf = (key) => {
    if (key !== "shin_l" && key !== "shin_r" && key !== "foot_l" && key !== "foot_r") return 0;
    const s = cfg.footSplayDeg * DEG;
    return key === "shin_l" || key === "foot_l" ? -s : s;
  };
  const bodies = [];
  for (const spec of SEGMENTS) {
    const part = PART_BY_KEY.get(spec.key);
    if (!part) throw new Error(`[skeleton] parts.json \u7F3A\u5C11\u7EC4\u4EF6 ${spec.key}`);
    const { length: boxLen, radius, halfHeight: boxHalf } = capsuleFromBox(
      part.bw * px2m,
      part.bh * px2m,
      cfg.limbRadiusScale
    );
    const ax = LIMB_AXES.axes[spec.key];
    let length = boxLen;
    let halfHeight = boxHalf;
    if (ax && TILTED.has(spec.key)) {
      length = Math.max(boxLen, ax.lenPx * px2m) + 2 * PIVOT_PAD;
      halfHeight = Math.max(1e-3, length / 2 - radius);
    }
    const tilt = restTiltOf(spec.key, !!spec.leg);
    const yaw = restYawOf(spec.key);
    const qRestInv = invQuatOf(restQuatOf(tilt, yaw));
    const qVisInv = invQuatOf(restVisualQuatOf(tilt));
    let centerY = mapY(part.cy);
    let centerZ = mapZ(part.cx, !!spec.leg);
    if (ax && TILTED.has(spec.key)) {
      const midY = (ax.proxTip[1] + ax.distTip[1]) / 2;
      const midX = (ax.proxTip[0] + ax.distTip[0]) / 2;
      centerY = mapY(midY);
      centerZ = mapZ(midX, !!spec.leg);
    }
    let footAnkle = null;
    if (cfg.ankleEnabled && spec.leg && (spec.soleMassPct ?? 0) > 0) {
      const side2 = spec.key === "shin_l" ? "l" : "r";
      const ak = LIMB_AXES.anchors?.[`foot_${side2}`];
      const kn = LIMB_AXES.anchors?.[`knee_${side2}`];
      if (ak && kn) {
        footAnkle = [kn[0], ak[1]];
        const shankLen = Math.abs(mapY(ak[1]) - mapY(kn[1]));
        const newLen = shankLen + 2 * PIVOT_PAD;
        const newHalfH = Math.max(1e-3, newLen / 2 - radius);
        length = newLen;
        halfHeight = newHalfH;
        centerY = (mapY(kn[1]) + mapY(ak[1])) / 2;
        centerZ = mapZ(kn[0], true);
      }
    }
    const plateOffset = rotVecByQuat(
      qVisInv,
      [0, mapY(part.cy) - centerY, mapZ(part.cx, !!spec.leg) - centerZ]
    );
    const cy2 = centerY;
    const totalMass = spec.massPct / 100 * cfg.mass;
    const solePct = spec.soleMassPct ?? 0;
    const mainMass = totalMass - solePct / 100 * cfg.mass;
    const colliders = [];
    const mainCom = comOffset(length, spec.comRatio, spec.proximal);
    const mainIz = mainMass * Math.pow(spec.gyrationRatio * length, 2);
    colliders.push({
      shape: "capsule",
      halfHeight,
      radius,
      hx: 0,
      hy: 0,
      hz: 0,
      offsetY: 0,
      offsetZ: 0,
      mass: mainMass,
      comY: mainCom,
      inertiaZ: mainIz,
      inertiaXY: mainIz * 0.5
    });
    if (solePct > 0) {
      const soleMass = solePct / 100 * cfg.mass;
      const sfx = Math.max(0.1, cfg.soleFootScale);
      const side = spec.key === "shin_l" ? "l" : "r";
      const paw = LIMB_AXES.paw?.[side];
      const knee = LIMB_AXES.anchors?.[spec.key === "shin_l" ? "knee_l" : "knee_r"];
      const anklePx = LIMB_AXES.anchors?.[spec.key === "shin_l" ? "foot_l" : "foot_r"];
      const hx = soleHalfLen * sfx;
      const hz = (paw ? paw.lateralHalf * px2m : radius * 0.9) * sfx;
      const soleWorldY = soleHalfThick;
      const soleWorldZ = mapZ(knee ? knee[0] : part.cx, true);
      const soleMassTotal = mainMass + soleMass;
      if (anklePx && cfg.ankleEnabled) {
        const ankleY = mapY(anklePx[1]);
        const ankleZ = mapZ(anklePx[0], true);
        const fTilt = 0;
        const fYaw = restYawOf(spec.key === "shin_l" ? "foot_l" : "foot_r");
        const fQInv = invQuatOf(restQuatOf(fTilt, fYaw));
        const soleDrop = ankleY;
        const fMidY = soleWorldY;
        const local2 = rotVecByQuat(fQInv, [0, fMidY - ankleY - SOLE_GROUND_CORR, 0]);
        bodies.push({
          key: spec.key === "shin_l" ? "foot_l" : "foot_r",
          bone: spec.bone,
          label: spec.key === "shin_l" ? "\u5DE6\u811A\u638C" : "\u53F3\u811A\u638C",
          part,
          // 贴图仍借小腿那张（渲染层按脚部区域做 UV 扭曲）
          cx: 0,
          cy: ankleY,
          cz: ankleZ,
          restTiltRad: fTilt,
          restYawRad: fYaw,
          // 贴图板偏移：脚掌**不单独画贴图** ⇒ 用一个大偏移把它藏到小腿板之外
          plateOffset: [0, 0, 0],
          plateHidden: true,
          // ★ 渲染层据此跳过这块板
          length: soleDrop,
          radius: 0,
          halfHeight: soleDrop / 2,
          mass: soleMass,
          colliders: [{
            shape: "cuboid",
            halfHeight: 0,
            radius: 0,
            hx,
            hy: soleHalfThick,
            hz,
            offsetY: local2[1],
            offsetZ: local2[2],
            mass: soleMass,
            comY: 0,
            inertiaZ: soleMass * (hx * hx + soleHalfThick * soleHalfThick) / 3,
            inertiaXY: soleMass * (hz * hz + soleHalfThick * soleHalfThick) / 3
          }],
          leg: true
        });
        bodies.push({
          key: spec.key,
          bone: spec.bone,
          label: spec.label,
          part,
          cx: 0,
          cy: cy2,
          cz: centerZ,
          restTiltRad: tilt,
          restYawRad: yaw,
          plateOffset,
          length,
          radius,
          halfHeight,
          mass: mainMass,
          colliders: [colliders[0]],
          leg: true
        });
        continue;
      }
      const local = rotVecByQuat(qRestInv, [0, soleWorldY - centerY, soleWorldZ - centerZ]);
      colliders.push({
        shape: "cuboid",
        halfHeight: 0,
        radius: 0,
        hx,
        hy: soleHalfThick,
        hz,
        offsetY: local[1],
        offsetZ: local[2],
        mass: soleMass,
        comY: 0,
        inertiaZ: soleMass * (hx * hx + soleHalfThick * soleHalfThick) / 3,
        inertiaXY: soleMass * (hz * hz + soleHalfThick * soleHalfThick) / 3
      });
    }
    if (spec.key === "torso" && K > 1) {
      const segLen = length / K;
      const segMass = totalMass / K;
      const hx = radius, hz = radius * 0.9;
      for (let s = 0; s < K; s++) {
        const cyS = cy2 - length / 2 + (s + 0.5) * segLen;
        const iZ = segMass * (hx * hx + segLen / 2 * (segLen / 2)) / 3;
        const iX = segMass * (segLen / 2 * (segLen / 2) + hz * hz) / 3;
        bodies.push({
          key: s === 0 ? "torso" : `spine${s + 1}`,
          bone: spec.bone,
          label: s === 0 ? "\u9AA8\u76C6" : `\u810A\u690E${s + 1}`,
          part,
          cx: 0,
          cy: cyS,
          cz: mapZ(part.cx, false),
          restTiltRad: 0,
          // 躯干不设静倾角（脊柱段要同朝向才能 LBS）
          restYawRad: 0,
          plateOffset: [0, 0, 0],
          // 蒙皮板由 viewer 逐段插值，不用刚体中心
          length: segLen,
          radius,
          halfHeight: segLen / 2,
          mass: segMass,
          colliders: [{
            shape: "cuboid",
            halfHeight: 0,
            radius: 0,
            hx,
            hy: segLen / 2,
            hz,
            offsetY: 0,
            offsetZ: 0,
            mass: segMass,
            comY: 0,
            inertiaZ: iZ,
            inertiaXY: iX
          }],
          leg: false,
          texSlice: { index: s, count: K }
        });
      }
      continue;
    }
    bodies.push({
      key: spec.key,
      bone: spec.bone,
      label: spec.label,
      part,
      cx: 0,
      // ★ 素材是正面视图，没有深度信息 ⇒ 前向一律 0
      cy: centerY,
      cz: centerZ,
      restTiltRad: tilt,
      restYawRad: yaw,
      plateOffset,
      length,
      radius,
      halfHeight,
      mass: totalMass,
      colliders,
      leg: !!spec.leg
    });
  }
  const byKey = new Map(bodies.map((b) => [b.key, b]));
  byKeyRef = byKey;
  const jointMetaByName = new Map(META.joints.map((j) => [j.name, j]));
  const joints = [];
  const JOINT_ORDER_ACTIVE = JOINT_ORDER.filter((n) => cfg.ankleEnabled || !n.startsWith("foot_"));
  JOINT_ORDER_ACTIVE.forEach((name, index) => {
    const jm = jointMetaByName.get(name);
    if (!jm) throw new Error(`[skeleton] parts.json \u7F3A\u5C11\u5173\u8282 ${name}`);
    const isAnkle = jm.child === "foot_l" || jm.child === "foot_r";
    const childPart = PART_BY_KEY.get(jm.child) ?? PART_BY_KEY.get(isAnkle ? jm.parent : "");
    if (!childPart) throw new Error(`[skeleton] \u5173\u8282 ${name} \u7684\u5B50\u90E8\u4EF6\u5143\u6570\u636E\u4E0D\u5B58\u5728`);
    const [axPx, ayPx] = anchorPx(name, jm);
    const parent = byKey.get(attachTo(jm.parent, mapY(ayPx)));
    const child = byKey.get(jm.child);
    if (!parent || !child) throw new Error(`[skeleton] \u5173\u8282 ${name} \u7684\u521A\u4F53\u4E0D\u5B58\u5728`);
    const stanceHere = legKeys.has(jm.child);
    const wx = 0;
    const stretch = /^(knee|foot)_/.test(name) ? cfg.legStretch : 0;
    const wy = mapY(ayPx) - stretch * (legKeys.has(jm.parent) ? 1 : 0);
    const wz = mapZ(axPx, stanceHere);
    const xy = JOINT_LIMITS_XY_DEG[name] ?? [20, 20];
    const flexMin = jm.limitDeg[0] * DEG;
    const flexMax = jm.limitDeg[1] * DEG;
    const tau2 = /^(foot|ankle)_/.test(name) ? cfg.ankleTorque : JOINT_MAX_TORQUE[name] ?? 100;
    const dParent = rotVecByQuat(
      invQuatOf(restQuatOf(parent.restTiltRad, parent.restYawRad)),
      [wx - parent.cx, wy - parent.cy, wz - parent.cz]
    );
    const dChild = rotVecByQuat(
      invQuatOf(restQuatOf(child.restTiltRad, child.restYawRad)),
      [wx - child.cx, wy - child.cy, wz - child.cz]
    );
    joints.push({
      name,
      index,
      parentKey: parent.key,
      childKey: child.key,
      wx,
      wy,
      wz,
      parentLocal: dParent,
      childLocal: dChild,
      // ★ 静姿态读数（父静姿态⁻¹ ⊗ 子静姿态），ragdoll 用它把关节零位挪到素材姿势
      restRad: quatToRotVec(quatRel(
        restQuatOf(parent.restTiltRad, parent.restYawRad),
        restQuatOf(child.restTiltRad, child.restYawRad)
      )),
      minRad: [-xy[0] * DEG, -xy[1] * DEG, flexMin],
      maxRad: [xy[0] * DEG, xy[1] * DEG, flexMax],
      maxTorque: [tau2 * TORQUE_AXIS_FACTOR[0], tau2 * TORQUE_AXIS_FACTOR[1], tau2 * TORQUE_AXIS_FACTOR[2]]
    });
  });
  if (K > 1) {
    const SPINE_XY_DEG = [15, 20];
    const SPINE_FLEX_DEG = [-25, 25];
    const SPINE_TAU = 120;
    for (let s = 0; s < K - 1; s++) {
      const p = byKey.get(segKey(s));
      const c = byKey.get(segKey(s + 1));
      if (!p || !c) throw new Error(`[skeleton] \u810A\u67F1\u6BB5 ${s} \u4E0D\u5B58\u5728`);
      const wy = (p.cy + c.cy) / 2;
      const wx = 0, wz = 0;
      joints.push({
        name: `spine${s + 1}`,
        index: joints.length,
        // ★ 接在 JOINT_ORDER 之后 = 网络输出接在后面
        parentKey: p.key,
        childKey: c.key,
        wx,
        wy,
        wz,
        parentLocal: [wx - p.cx, wy - p.cy, wz - p.cz],
        childLocal: [wx - c.cx, wy - c.cy, wz - c.cz],
        restRad: [0, 0, 0],
        // 躯干段无静倾角 ⇒ 关节零位就是素材姿势
        minRad: [-SPINE_XY_DEG[0] * DEG, -SPINE_XY_DEG[1] * DEG, SPINE_FLEX_DEG[0] * DEG],
        maxRad: [SPINE_XY_DEG[0] * DEG, SPINE_XY_DEG[1] * DEG, SPINE_FLEX_DEG[1] * DEG],
        maxTorque: [
          SPINE_TAU * TORQUE_AXIS_FACTOR[0],
          SPINE_TAU * TORQUE_AXIS_FACTOR[1],
          SPINE_TAU * TORQUE_AXIS_FACTOR[2]
        ]
      });
    }
  }
  const massTotal = bodies.reduce((s, b) => s + b.mass, 0);
  return {
    cfg,
    px2m,
    centerPx,
    groundPx,
    bodies,
    joints,
    totalHeight: extent.h * px2m,
    massTotal
  };
}

// tools/probe-stability.ts
var log = (...a) => console.log(...a);
var failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
}
function note(name, detail = "") {
  log(`  info  ${name}${detail ? "   " + detail : ""}`);
}
var f = (x, n = 4) => x.toFixed(n);
var G = 9.81;
var sk = buildSkeleton(DEFAULT_CONFIG);
log("\u7AD9\u7ACB\u53EF\u884C\u6027 \u2014\u2014 CoP \u6743\u9650 / CoM \u5012\u7ACB\u6446\u5224\u636E");
log(`  \u9AA8\u67B6\uFF1A${sk.bodies.length} \u521A\u4F53 / ${sk.joints.length} \u5173\u8282 / \u603B\u8D28\u91CF ${f(sk.massTotal, 1)} kg`);
log("");
var all = [];
for (const b of sk.bodies) {
  for (const c of b.colliders) {
    const halfY = c.shape === "cuboid" ? c.hy : c.halfHeight + c.radius;
    const bottom = b.cy + c.offsetY - halfY;
    const hx = c.shape === "cuboid" ? c.hx : c.radius;
    const hz = c.shape === "cuboid" ? c.hz : c.radius;
    all.push({ key: b.key, shape: c.shape, bottom, x0: b.cx - hx, x1: b.cx + hx, z0: b.cz - hz, z1: b.cz + hz });
  }
}
var groundY = Math.min(...all.map((c) => c.bottom));
var CONTACT_BAND = 0.02;
var feet = all.filter((c) => c.bottom <= groundY + CONTACT_BAND).map((c) => ({ key: `${c.key}(${c.shape})`, x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1 }));
if (feet.length === 0) throw new Error("[probe-stability] \u627E\u4E0D\u5230\u63A5\u5730\u78B0\u649E\u4F53");
var hull = {
  x0: Math.min(...feet.map((r) => r.x0)),
  x1: Math.max(...feet.map((r) => r.x1)),
  z0: Math.min(...feet.map((r) => r.z0)),
  z1: Math.max(...feet.map((r) => r.z1))
};
var xHalf = (hull.x1 - hull.x0) / 2;
var zHalf = (hull.z1 - hull.z0) / 2;
log("[A] \u652F\u6491\u591A\u8FB9\u5F62\uFF08CoP \u53EF\u884C\u57DF = \u63A5\u5730\u78B0\u649E\u4F53\u8DB3\u8FF9\u7684\u51F8\u5305\uFF09");
log(`      \u6700\u4F4E\u70B9 y = ${f(groundY, 4)} m\uFF0C\u63A5\u89E6\u5E26 = [${f(groundY, 4)}, ${f(groundY + CONTACT_BAND, 4)}]`);
for (const c of all) {
  const touching = c.bottom <= groundY + CONTACT_BAND;
  log(`      ${touching ? "\u25CF" : " "} ${c.key.padEnd(7)} ${c.shape.padEnd(8)} bottom=${f(c.bottom, 3)}  X[${f(c.x0, 3)}, ${f(c.x1, 3)}] Z[${f(c.z0, 3)}, ${f(c.z1, 3)}]`);
}
log(`      \u63A5\u5730 ${feet.length} \u4E2A\uFF1A${feet.map((r) => r.key).join(", ")}`);
log(`      \u51F8\u5305    X[${f(hull.x0, 3)}, ${f(hull.x1, 3)}]  Z[${f(hull.z0, 3)}, ${f(hull.z1, 3)}]`);
log(`      \u21D2 \u524D\u540E\u534A\u5BBD p_max,X = ${f(xHalf)} m     \u4FA7\u5411\u534A\u5BBD p_max,Z = ${f(zHalf)} m`);
note("\u2605 \u524D\u540E\u662F\u8FD9\u4E2A\u9AA8\u67B6\u7684**\u6700\u5F31\u65B9\u5411**", `\u53EA\u6709 \xB1${f(xHalf)} m \u2014\u2014 \u800C\u524D\u540E\u6B63\u662F"\u8D70\u8DEF/\u88AB\u63A8"\u7684\u65B9\u5411`);
log("");
var mtot = 0;
var cy = 0;
var cz = 0;
var contrib = [];
for (const b of sk.bodies) {
  let bm = 0, bMy = 0;
  for (const c of b.colliders) {
    bm += c.mass;
    bMy += c.mass * (c.offsetY + c.comY);
  }
  const y = b.cy + (bm > 0 ? bMy / bm : 0);
  mtot += bm;
  cy += bm * y;
  cz += bm * b.cz;
  contrib.push({ key: b.key, m: bm, y });
}
cy /= mtot;
cz /= mtot;
log("[B] \u7ED1\u5B9A\u59FF\u6001\u6574\u4F53\u91CD\u5FC3");
log(`      CoM = (0.000, ${f(cy)}, ${f(cz)}) m      \u8EAB\u9AD8 ${f(sk.totalHeight, 2)} m`);
var marginX = xHalf - Math.abs(0);
var marginZ = Math.min(hull.z1 - cz, cz - hull.z0);
log(`      \u9759\u7A33\u5B9A\u4F59\u91CF\uFF08\u524D\u540E\uFF09= ${f(marginX)} m       \uFF08\u4FA7\u5411\uFF09= ${f(marginZ)} m`);
check(
  "B1 \u7ED1\u5B9A\u59FF\u6001 CoM \u6295\u5F71\u843D\u5728\u652F\u6491\u591A\u8FB9\u5F62\u5185",
  marginX > 0 && marginZ > 0,
  `\u524D\u540E\u4F59\u91CF ${f(marginX)} / \u4FA7\u5411\u4F59\u91CF ${f(marginZ)}`
);
note("\u2605 \u9759\u529B\u4F59\u91CF\u770B\u7740\u8FD8\u884C\uFF0C\u4F46**\u9759\u529B\u5224\u636E\u662F\u9519\u7684**", "\u771F\u5B9E\u7EA6\u675F\u662F\u4E0B\u9762\u7684 DCM\uFF08\u52A8\u6001\uFF09\u5224\u636E\uFF0C\u6BD4\u5B83\u4E25\u5F97\u591A");
log("");
var zc = cy;
var omega = Math.sqrt(G / zc);
var tau = 1 / omega;
var aMax = omega * omega * xHalf;
var vCatch = omega * xHalf;
var tDeadline = (xi) => Math.log(xHalf / xi) / omega;
log("[C] \u7EBF\u6027\u5012\u7ACB\u6446\uFF08LIPM\uFF09\u5E38\u6570");
log(`      z_c\uFF08CoM \u9AD8\u5EA6\uFF09        = ${f(zc)} m`);
log(`      \u03C9 = \u221A(g/z_c)           = ${f(omega)} rad/s     \u65F6\u95F4\u5E38\u6570 \u03C4 = ${f(tau)} s`);
log(`      \u6700\u5927\u53EF\u63A7 CoM \u52A0\u901F\u5EA6    = \u03C9\xB2\xB7p_max = ${f(aMax)} m/s\xB2\uFF08= ${f(aMax / G)} g\uFF09`);
log(`      x=0 \u65F6\u6700\u5927\u53EF\u5239 CoM \u901F\u5EA6 = \u03C9\xB7p_max = ${f(vCatch)} m/s`);
note("\u2605 \u53D1\u6563\u901F\u5EA6", `\u505C\u6EDE\u4E0D\u63A7\u65F6 DCM \u6309 e^{t/\u03C4} \u589E\u957F \u2014\u2014 ${f(tau)} s \u4E00\u6DA8 e \u500D\uFF08\xD72.72\uFF09`);
note("\u2605 \u53CD\u9988\u622A\u6B62\u65F6\u95F4", `\u82E5 DCM \u5DF2\u5230 ${f(xHalf / 2, 3)} m\uFF08\u4F59\u91CF\u4E00\u534A\uFF09\uFF0C\u4EC0\u4E48\u90FD\u4E0D\u505A\u8FD8\u6709 ${f(tDeadline(xHalf / 2), 3)} s \u5C31\u5FC5\u987B\u8FC8\u6B65`);
log("");
log("[D] DCM \u6355\u83B7\u5224\u636E\uFF1A\u03BE = x + \u1E8B/\u03C9 \u5FC5\u987B \u2264 p_max,X = " + f(xHalf) + " m");
log("      CoM \u901F\u5EA6 \u1E8B      \u5141\u8BB8\u7684 CoM \u4F4D\u7F6E\u4F59\u91CF |x|max     \u8BF4\u660E");
var speeds = [0, 0.05, 0.1, 0.2, 0.3, vCatch, 0.5, 1];
for (const v of speeds) {
  const slack = xHalf - v / omega;
  const tag = slack <= 0 ? "\u2605 \u5373\u4F7F CoM \u6B63\u597D\u5728\u4E2D\u5FC3\u4E5F\u5DF2\u7ECF\u5239\u4E0D\u4F4F \u21D2 \u5FC5\u987B\u8FC8\u6B65" : slack < 0.03 ? "\u4F59\u91CF\u6781\u8584" : "";
  log(`      ${f(v, 3)} m/s      ${(slack > 0 ? "+" + f(slack, 3) : f(slack, 3)).padStart(9)} m            ${tag}`);
}
check(
  "D1 \u6B65\u901F\u91CF\u7EA7\uFF08\u22650.5 m/s\uFF09\u4E0B\u9759\u6B62\u7AD9\u7ACB\u5DF2\u4E0D\u53EF\u6062\u590D\uFF08\u21D2 \u7AD9\u4E0E\u8D70\u662F\u4E24\u4E2A\u57DF\uFF09",
  0.5 > vCatch,
  `0.5 m/s > \u53EF\u5239\u4E0A\u9650 ${f(vCatch)} m/s`
);
log("");
log(`      \u21D2 \u7AD9\u7ACB\u4E0D\u52A8 \u27FA |\u1E8B| \u2272 ${f(vCatch, 2)} m/s \u4E14 |x| \u5F88\u5C0F\u3002\u4E00\u65E6\u8FDB\u5165\u8D70\u8DEF\uFF08~1 m/s\uFF09\uFF0C`);
log(`         "\u9760\u8C03 CoP \u7AD9\u4F4F"\u5728\u6570\u5B66\u4E0A\u5C31\u4E0D\u53EF\u80FD\uFF0C\u53EA\u6709**\u8FC8\u6B65**\u80FD\u6551\uFF08\u628A\u652F\u6491\u591A\u8FB9\u5F62\u642C\u5230 DCM \u524D\u9762\uFF09\u3002`);
log("");
log("[E] \u6469\u64E6\u662F\u4E0D\u662F\u74F6\u9888\uFF1F\uFF08\u6392\u9664\u9879\uFF09");
var N = mtot * G;
var Fric = 1 * N;
var tFric = mtot * 0.1 / Fric;
log(`      \u6B63\u538B\u529B N \u2248 ${f(N, 0)} N      \u6469\u64E6\u4E0A\u9650 \u03BC\xB7N\uFF08\u03BC=1.0\uFF09\u2248 ${f(Fric, 0)} N`);
log(`      \u5239\u4F4F 0.1 m/s \u7684 CoM \u53EA\u9700\u8981 ${f(tFric * 1e3, 2)} ms \u7684\u5168\u529B\u6C34\u5E73\u63A8\u529B`);
check(
  "E1 \u6469\u64E6\u4E0D\u662F\u9650\u5236\u9879\uFF08\u51E0\u4F55/CoP \u9650\u8FDC\u6BD4\u6469\u64E6\u5148\u5230\uFF09",
  tFric < 0.02,
  `${f(tFric * 1e3, 2)} ms \u226A \u03C4 = ${f(tau)} s`
);
log("");
log('[F] \u89C2\u6D4B\u4E0E\u9002\u5E94\u5EA6\u4F53\u68C0\uFF1A\u73B0\u5728\u8C03\u7684\u662F"\u80F8\u8154"\uFF0C\u4E0D\u662F CoM');
var chest = sk.bodies[sk.bodies.map((b, i) => b.texSlice ? i : -1).filter((i) => i >= 0).pop()];
var chestMass = chest.mass;
var torsoMass = contrib.filter((c) => sk.bodies.find((b) => b.key === c.key).texSlice).reduce((s, c) => s + c.m, 0);
var aboveHip = contrib.filter((c) => c.y > sk.joints.find((j) => j.name === "hip_l").wy).reduce((s, c) => s + c.m, 0);
log(`      \u80F8\u8154\uFF08${chest.key}\uFF09\u8D28\u91CF        = ${f(chestMass, 2)} kg = \u5168\u8EAB ${f(chestMass / mtot * 100, 1)}%`);
log(`      \u80F8\u8154\u4E2D\u5FC3 y                = ${f(chest.cy)} m   \uFF08CoM y = ${f(cy)} m\uFF0C\u5DEE ${f(chest.cy - cy)} m\uFF09`);
log(`      \u8EAF\u5E72 4 \u6BB5\u5408\u8BA1              = ${f(torsoMass, 2)} kg = ${f(torsoMass / mtot * 100, 1)}%`);
log(`      \u9ACB\u4EE5\u4E0A\u5168\u90E8                 = ${f(aboveHip, 2)} kg = ${f(aboveHip / mtot * 100, 1)}%`);
log(`      \u21D2 \u9ACB\u4EE5\u4E0B\uFF08\u817F+\u811A\uFF09           = ${f(mtot - aboveHip, 2)} kg = ${f((mtot - aboveHip) / mtot * 100, 1)}%`);
log("");
log("      \u5F53\u524D\u89C2\u6D4B\uFF08sim.ts controlTick\uFF0C88 \u7EF4\uFF09\uFF1A");
log("        x[2..5]  \u80F8\u8154\u56DB\u5143\u6570      x[6..8]  \u80F8\u8154\u7EBF\u901F\u5EA6      x[9..11] \u80F8\u8154\u89D2\u901F\u5EA6");
log("        x[12]    \u80F8\u8154\u9AD8\u5EA6 y      x[13]    \u80F8\u8154\u4FA7\u504F z");
log("        x[14..]  12 \u5173\u8282\u89D2 \xD73    + 12 \u5173\u8282\u76F8\u5BF9\u89D2\u901F\u5EA6 \xD73    + \u5DE6\u53F3\u811A\u9AD8\u5EA6 \xD72");
check(
  "F1 \u89C2\u6D4B\u91CC**\u6CA1\u6709** CoM / CoM \u901F\u5EA6 / CoP / DCM",
  true,
  '\u21D2 \u7B56\u7565\u5728\u539F\u7406\u4E0A\u62FF\u4E0D\u5230"\u91CD\u5FC3"\u8FD9\u4E2A\u91CF\uFF0C\u53EA\u80FD\u9760\u80F8\u8154\u59FF\u6001\u95F4\u63A5\u63A8\u65AD'
);
check(
  "F2 \u9002\u5E94\u5EA6\u7684\u76F4\u7ACB/\u5E73\u8861\u9879\u5168\u90E8\u57FA\u4E8E**\u80F8\u8154**",
  true,
  `tiltOf(chest) \u4E0E tp.z\uFF1B\u4F46\u80F8\u8154\u53EA\u5360 ${f(chestMass / mtot * 100, 1)}% \u8D28\u91CF`
);
note(
  "\u2605 \u7528\u80F8\u8154\u4EE3\u7406 CoM \u7684\u4EE3\u4EF7",
  `\u7ED5\u8D28\u5FC3\u7684\u529B\u81C2\u5DEE ${f(Math.abs(chest.cy - cy))} m \u21D2 \u80F8\u8154\u76F4\u7ACB \u2260 CoM \u843D\u5728\u652F\u6491\u57DF\u5185`
);
log('[G] \u8BBE\u8BA1\u654F\u611F\u5EA6\uFF1A\u6539\u6A21\u578B\u80FD\u4E70\u5230\u591A\u5C11"\u53EF\u7AD9\u901F\u5EA6" v_catch = \u03C9\xB7p_max');
var dvDp = omega;
var dvDz = -(omega * xHalf) / (2 * zc);
var footLen = hull.x1 - hull.x0;
log(`      \u2202v_catch/\u2202p_max = \u03C9            = ${f(dvDp, 3)} (m/s) per m  \u2014\u2014 \u652F\u6491\u9762\u52A0\u957F\u662F**\u7EBF\u6027**\u6536\u76CA`);
log(`      \u2202v_catch/\u2202z_c   = \u2212\u03C9\xB7p_max/2z_c = ${f(dvDz, 3)} (m/s) per m  \u2014\u2014 \u964D\u91CD\u5FC3\u53EA\u6709**\u5F00\u65B9**\u6536\u76CA`);
log(`      \u7B49\u4EF7\u6362\u7B97\uFF1A\u811A\u638C\u52A0\u957F 1 cm  \u2248  \u91CD\u5FC3\u964D\u4F4E ${f(Math.abs(dvDp * 0.01 / dvDz) * 100, 1)} cm`);
log("");
log(`      \u811A\u638C\u957F = ${f(footLen, 3)} m\uFF08= \u8EAB\u9AD8\u7684 ${f(footLen / sk.totalHeight * 100, 1)}%\uFF09`);
log(`      \u89E3\u5256\u5B66\u53C2\u8003\uFF1A\u8DB3\u957F/\u8EAB\u9AD8 \u2248 15% \u21D2 1.80 m \u7684\u4EBA\u5E94\u6709 ${f(1.8 * 0.15, 3)} m`);
log(`      \u21D2 \u7D20\u6750\u7684\u811A\u6BD4\u89E3\u5256\u503C\u77ED ${f((1 - footLen / (1.8 * 0.15)) * 100, 1)}%\uFF0C\u800C\u4E14**\u6CA1\u6709\u8E1D\u5173\u8282**`);
log(`        \uFF08\u771F\u4EBA\u7AD9\u4E0D\u7A33\u65F6\u9760\u8E1D\u5173\u8282\u628A CoP \u5F80\u524D\u9876\u5230\u811A\u8DBE\uFF0C\u672C\u9AA8\u67B6\u505A\u4E0D\u5230\uFF09`);
check(
  "G1 \u652F\u6491\u9762\u52A0\u957F\u7684\u8FB9\u9645\u6536\u76CA\u8FDC\u9AD8\u4E8E\u964D\u91CD\u5FC3",
  Math.abs(dvDp) > 10 * Math.abs(dvDz),
  `${f(dvDp, 3)} vs ${f(dvDz, 3)} \u2014\u2014 \u5DEE ${f(Math.abs(dvDp / dvDz), 1)} \u500D`
);
log("");
log('[H] \u5EFA\u6A21\u6CE8\u610F\uFF1A\u811A\u5E95\u662F"\u5E73\u677F + \u7403\u5E95"\u6DF7\u5408\u63A5\u89E6');
{
  const cap = all.find((c) => c.key === "shin_l" && c.shape === "capsule");
  const box = all.find((c) => c.key === "shin_l" && c.shape === "cuboid");
  log(`      \u5C0F\u817F\u80F6\u56CA\u5E95\u7AEF y=${f(cap.bottom, 4)} m\uFF0C\u811A\u638C\u6241\u76D2\u5E95\u9762 y=${f(box.bottom, 4)} m`);
  note(
    "\u4E24\u8005\u9F50\u5E73 \u21D2 \u811A\u638C\u5E73\u9762\u4E0E\u80F6\u56CA\u5E95\u7403\u76F8\u5207",
    '\u5E73\u5766\u5730\u9762\u4E0A\u7531\u5E73\u677F\u4E3B\u5BFC\uFF0C\u65E0\u788D\uFF1B\u4F46\u4E00\u65E6\u811A\u503E\u659C\uFF0C\u80F6\u56CA\u7403\u5E95\u4F1A\u53D8\u6210"\u6447\u6905"\u63A5\u89E6\u70B9\uFF0C\u6709\u6548 CoP \u4F1A\u6BD4\u811A\u638C\u77E9\u5F62\u66F4\u7A84'
  );
  note("\u51F8\u5305\u5B9E\u9645\u7531 cuboid \u51B3\u5B9A", `capsule \u8DB3\u8FF9 X[\xB1${f(cap.x1, 3)}] \u2282 cuboid X[\xB1${f(box.x1, 3)}]`);
}
log("");
log(failures === 0 ? "  \u2705 probe-stability \u5168\u90E8\u901A\u8FC7" : `  \u274C probe-stability \u5931\u8D25 ${failures} \u9879`);
process.exitCode = failures === 0 ? 0 : 1;
