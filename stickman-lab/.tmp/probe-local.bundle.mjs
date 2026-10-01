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
  }
};

// src/core/partsMeta.ts
var META = parts_default;
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
  const cx = -a[0], cy = -a[1], cz = -a[2], cw = a[3];
  return [
    cw * b[0] + cx * b[3] + cy * b[2] - cz * b[1],
    cw * b[1] - cx * b[2] + cy * b[3] + cz * b[0],
    cw * b[2] + cx * b[1] - cy * b[0] + cz * b[3],
    cw * b[3] - cx * b[0] - cy * b[1] - cz * b[2]
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
  soleFootScale: 1,
  // ★★ 脚掌外八 25°（用户定调："脚要向外侧倾斜，做成外八"，随后"再向外一点"）。
  //   脚掌盒的**横向位置**仍按膝锚点摆（膝到脚尖铅垂），外八只改脚尖的朝向。
  footSplayDeg: 25
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
  "knee_r"
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
  knee_r: 150
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
  knee_r: [6, 8]
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
  const TILTED = /* @__PURE__ */ new Set(["arm_l", "arm_r", "hand_l", "hand_r", "thigh_l", "thigh_r", "shin_l", "shin_r"]);
  const restTiltOf = (key, leg) => {
    if (!TILTED.has(key)) return 0;
    if (key === "shin_l" || key === "shin_r") return 0;
    const ax = LIMB_AXES.axes[key];
    if (!ax) return 0;
    return Math.atan(ax.k * (leg ? cfg.stance : 1));
  };
  const restYawOf = (key) => {
    if (key !== "shin_l" && key !== "shin_r") return 0;
    const s = cfg.footSplayDeg * DEG;
    return key === "shin_l" ? -s : s;
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
      length = Math.max(boxLen, ax.lenPx * px2m);
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
    const plateOffset = rotVecByQuat(
      qVisInv,
      [0, mapY(part.cy) - centerY, mapZ(part.cx, !!spec.leg) - centerZ]
    );
    const cy = centerY;
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
      const hx = soleHalfLen * sfx;
      const hz = (paw ? paw.lateralHalf * px2m : radius * 0.9) * sfx;
      const soleWorldY = soleHalfThick;
      const soleWorldZ = mapZ(knee ? knee[0] : part.cx, true);
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
        // 脚掌自己的质心就在它中心；到刚体总质心的平行轴项由 Rapier 承担
        inertiaZ: soleMass * (hx * hx + soleHalfThick * soleHalfThick) / 3,
        inertiaXY: soleMass * (hz * hz + soleHalfThick * soleHalfThick) / 3
      });
    }
    if (spec.key === "torso" && K > 1) {
      const segLen = length / K;
      const segMass = totalMass / K;
      const hx = radius, hz = radius * 0.9;
      for (let s = 0; s < K; s++) {
        const cyS = cy - length / 2 + (s + 0.5) * segLen;
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
  JOINT_ORDER.forEach((name, index) => {
    const jm = jointMetaByName.get(name);
    if (!jm) throw new Error(`[skeleton] parts.json \u7F3A\u5C11\u5173\u8282 ${name}`);
    const childPart = PART_BY_KEY.get(jm.child);
    if (!childPart) throw new Error(`[skeleton] \u5173\u8282 ${name} \u7684\u5B50\u90E8\u4EF6\u5143\u6570\u636E\u4E0D\u5B58\u5728`);
    const [axPx, ayPx] = anchorPx(name, jm);
    const parent = byKey.get(attachTo(jm.parent, mapY(ayPx)));
    const child = byKey.get(jm.child);
    if (!parent || !child) throw new Error(`[skeleton] \u5173\u8282 ${name} \u7684\u521A\u4F53\u4E0D\u5B58\u5728`);
    const stanceHere = legKeys.has(jm.child);
    const wx = 0;
    const wy = mapY(ayPx);
    const wz = mapZ(axPx, stanceHere);
    const xy = JOINT_LIMITS_XY_DEG[name] ?? [20, 20];
    const flexMin = jm.limitDeg[0] * DEG;
    const flexMax = jm.limitDeg[1] * DEG;
    const tau = JOINT_MAX_TORQUE[name] ?? 100;
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
      maxTorque: [tau * TORQUE_AXIS_FACTOR[0], tau * TORQUE_AXIS_FACTOR[1], tau * TORQUE_AXIS_FACTOR[2]]
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

// tools/probe-local.ts
var sk = buildSkeleton(DEFAULT_CONFIG);
console.log("joint                 worldAnchor            parentLocal(mm)        childLocal(mm)");
for (const j of sk.joints) {
  const p = sk.bodies.find((b) => b.key === j.parentKey);
  const c = sk.bodies.find((b) => b.key === j.childKey);
  const f = (v) => `(${v.map((x) => (x * 1e3).toFixed(0).padStart(5)).join(",")})`;
  console.log(`  ${j.name.padEnd(11)} ${f([j.wx, j.wy, j.wz])}  P${f(j.parentLocal)}  C${f(j.childLocal)}   childTilt=${(c.restTiltRad * 180 / Math.PI).toFixed(1)}deg childLen=${c.length.toFixed(3)} reach=${(c.halfHeight + c.radius).toFixed(3)}`);
}
