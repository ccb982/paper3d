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
  // ★★ 站距。**判据 = 支撑面位置**，不是"对齐 Perry 的 step width"。
  //
  // ⚠⚠ 曾经的量纲错误（已更正）：把本 rig 的**踝间距**去比 Perry 的
  //   **step width 0.075m** ⇒ 得出"4.4× 人类"的错误结论。两者不是同一个量：
  //   step width = **相邻两步落点的横向间距**；站距 = **站立时双脚间距**。
  //
  // ★ 正确的文献基准 —— **Winter 1998**（J Neurophysiology 80:1211）按
  //   **hip-to-hip 的百分比**给站距，扫了 **50% / 100% / 150%** 三档：
  //   "Sway amplitude **decreased** as stance width increased, and **Ke
  //   increased with stance width**"（sway ∝ Ke^−0.55）
  //   ⇒ **宽站距 = 更稳**（刚度更高），不是更不稳。
  //
  // ★ 身高换算（本 rig 身高 **1.80 m**）：
  //   · Perry step width 0.075 m = **4.2% 身高**
  //   · 真实髋间距（biiliac）≈ 0.28 m = **15.6% 身高**
  //   · 真实站立踝间距 ≈ 0.10~0.15 m = 髋间距的 **35~55%**
  //   本 rig 髋间距 **0.25 m**（≈人类 0.28 m ✓）⇒ 站距 0.10~0.15 m 即
  //   `stance ≈ 0.25~0.40`。**本 rig 原来的 `stance=1.0`（站距 0.347m =
  //   髋的 139%）落在 Winter 实测区间内，并不离谱**，只是支撑面太靠外、
  //   重心爬不进去。
  //
  // ★★ 站距影响重心转移的**真实机制**（不是"稳不稳"，而是"进不进得去"）：
  //   重心不必到脚心，只需进入**脚掌横向范围**（真实足宽≈100mm，半 50mm）：
  //     stance=0.35 → 脚心 ±78mm ⇒ 支撑面 z∈[28,128]mm，重心到 **28mm** 即进入
  //     stance=1.00 → 脚心 ±163mm ⇒ 支撑面 z∈[113,213]mm，重心要爬到 **113mm**
  //   而 `handoverTolZ=50mm` 要重心到脚心 50mm 内 ⇒ 两者难度天差地别。
  //   实测（`tools/probe-stance.ts`）：0.00s(347mm) / 0.23s(226mm) /
  //   0.00s(162mm) / 0.52s(101mm) / 0.58s(29mm)。
  // ⚠ 下限受**脚宽**约束：脚掌半宽 ≈75mm ⇒ 踝距 <150mm 时两脚互相穿模。
  //   所以 **0.35（踝距 156mm、两脚刚好相切 = 髋的 65%）是物理下限**。
  // ★★ 2026-10-05 用户决定：**回到 stance = 1.0**（原值）。
  //   理由：0.35 的站距**观感不成立** —— 这是要放进游戏里的 boss 角色，
  //   两脚几乎相切看起来不像人形。⇒ 站距是**角色设计参数**，
  //   不是可以为了指标牺牲的自由量。
  //   ⚠ 回退曾**静默失败**（编辑的字符串没匹配上，而脚本无条件打印 'ok'）。
  //     `tools/probe-readback.ts` 就是为此写的：任何配置改动后必须回读实际数值。
  //   代价（已知并接受）：`stance=1.00` 时重心进入支撑面需横移 **117mm**
  //   （`stance=0.35` 只要 28mm），X3 驻留回到 0.00s。
  //   ⇒ 重心转移必须从**别的方向**解决（伺服/迈步的平衡、相位时长对齐、
  //     髋外展权限、脚宽），**不再靠缩站距**。
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
  // 裁剪线上移到踝锚点以上 123mm ⇒ 脚掌板高约 202mm（原 101mm 的两倍）
  footCropUpMm: 0.123,
  footCropOverlapMm: 0.01,
  // 冗余：绝对 10mm 与"脚掌高度的 10%"取大者 ⇒ 脚加高时自动跟着长
  footCropOverlapFrac: 0.1,
  soleGroundCorr: 0,
  soleSplit: true,
  // ★★ 脚掌外八 25°（用户定调："脚要向外侧倾斜，做成外八"，随后"再向外一点"）。
  //   脚掌盒的**横向位置**仍按膝锚点摆（膝到脚尖铅垂），外八只改脚尖的朝向。
  footSplayDeg: 25,
  // 踝：低头 25°（蹬地/尖脚）… 勾脚 20°（脚跟先着地）。保守取值，避免刚体互穿。
  anklePitchDeg: [0, 0],
  ankleRollDeg: 0,
  // ★★ 踝力矩上限（N·m）。原来 45 —— **解剖学上错了近 3 倍**。
  //   文献：踝跖屈（比目鱼肌+腓肠肌）是人体最大的肌群，年轻人最大自主收缩
  //   ~110~140 N·m（Noble & Norkowitz；Winter 1990 的踝策略力矩同量级）。
  //   45 经 TORQUE_AXIS_FACTOR 后三轴只有 27/15.8/45 N·m ⇒
  //     · 蹬离做不出来（实测 PUSH 相膝已 150/150 打满而踝只有 27）
  //     · CoP 可偏移仅 τ/F_z = 27/687 = **39mm**，做不了额状面主通道
  //   120 ⇒ 外展轴 72 N·m ⇒ CoP 偏移 72/687 = **105mm** ≈ 脚半宽 100mm
  //   （正好把 CoP 驱到足缘 —— van Mierlo 2022/2024：CMP 出支撑面是合法的）
  ankleTorque: 120,
  /**
   * ★ 髋**外展轴**的 τmax = `JOINT_MAX_TORQUE.hip × hipAbdTorqueFactor`。
   *   1.00 = 与屈伸轴同量级（200 N·m）；0.60 = 原值（120）。
   *   可扫，因为放开权限后实测**反而更差**（15 档刚度/阻尼组合全部驻留 0.00s，
   *   而 τmax=120 时同一律能到驻留 0.42s / 最小 X3 = 2mm）⇒ 髋外展权限
   *   **不是瓶颈**，多给会让它冲过目标。Inman 的 112 N·m 静态需求在 120 时
   *   已占 93%，实测那个余量恰好够用。
   */
  hipAbdTorqueFactor: 0.6,
  // 弓关节限位（deg）：[旋后, 旋前]。上限 16 刻意小于"踩实"所需的 ~28（见下方注释）
  archLimitDeg: [-4, 16],
  /** 弓关节锚点沿足长的位置（0=足跟端, 1=脚尖端）。默认 0.22 = 弓的近端 */
  archAtFrac: 0.22,
  archRise: 0,
  // ★ 实测定的（不是人体解剖值 20~25mm）
  // ★★ **默认 0（不留缝）** —— 实测空缝并未压掉 60Hz 周期-2 振动：
  //   gap=1.5/4/10mm 得到的去趋势帧间是 24.5 / 9.1 / 18.4mm（无单调趋势，是噪声），
  //   主周期恒为 2 帧。⇒ 共面接缝不是振动来源，默认开启只会无意义地改动质量分布。
  //   开关保留着，等找到真正的接触层解法后再调。
  soleBlockGap: 0,
  // ★ 踝屈伸**机械硬限位**（背屈 −12°/ 跖屈 +18°）。比素材 limitDeg 略紧，
  //   模拟距骨滑车的几何锁定（mortise wedging），防踝被力矩甩出去导致崴脚。
  ankleLimitDeg: [-12, 18],
  // ★ 中足关节位置（足长相对）：0.5 = 几何中心（两段等长、力臂对称）
  forefootAtFrac: 0.5,
  // ★ 中足（距下关节）旋前/旋后行程 ±12°（人体被动 ROM 是内翻 35°/外翻 14°）
  // ★ 中足（距下关节）旋前/旋后行程。
  //   ⚠ 2026-10-04 实测：**12° 不够**。要让内侧缘**离地**（从而卸载内侧柱、
  //   把载荷转到外侧柱），必须 `tanθ > 足厚/足宽 = 52/100` ⇒ **θ > 27.5°**；
  //   12° 只能把内侧缘抬 5mm，对着 26mm 的半厚根本脱离不了接触。
  //   实测佐证：刚度从 30 扫到 2000 N·m/rad，CoP_z 幅度恒为 18~19mm（全是单柱受力），
  //   随刚度零变化 ⇒ 柔性**没参与**。
  //   取 **±34°**（解剖学距下关节内翻 ~35°，见 `JOINT_LIMITS_XY_DEG` 踝条目注释）。
  midfootPronDeg: 34,
  footUvWarpDeg: 0,
  // ★ 踝**常开**（用户 2026-10-04：「脚踝是要一直开的，脚踝是肯定有用的，
  //   脚需要转向」）。之前这里是 false，导致只有 web 端（lab.ts 的
  //   DEFAULT_LAB.ankle = true）有踝，所有探针/默认配置都建成 12 关节无踝骨架。
  //   ⚠ 踝提供的是**转向**（roll/pitch/twist 三轴）+ 足底 CoP 权限；
  //     额状面平衡的主动力仍在髋（Winter 1995 [H]：并立站位 M/L 归髋不归踝）。
  ankleEnabled: true
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
  // ★ 额状面力矩预算（文献数字，记在这里备用；**暂时保持 200**，见下）：
  //     Inman 1947：单腿站立理论最小髋外展力矩 = 体重 × 半髋间距
  //                  = 687 N × 0.163 m = **112 N·m**
  //     hip=200 × TORQUE_AXIS_FACTOR[0]=0.60 ⇒ 外展轴 **120 N·m** ⇒ 占用 **93%**
  //     （文献实测：健康青年男 ~50%、健康老年女 ~82%）
  //   2026-10-04 实测把 hip 提到 250（外展 150 N·m、占用 75%）与
  //   SPINE_TAU 提到 180（侧屈 108 N·m，依据「腰椎侧屈半程 ⇒ 髋外展需求 −37%」）：
  //     侧向权限没变好、单支撑仍然 0.00s，**存活反而从 2.37s 掉到 1.97s**。
  //   ⇒ 原因不是额度不够，而是**矢状面就没稳住**（探针 E5：躯干倾角从 t=0.2s 起
  //     就在 8~27° 振荡，t=1.4s 踝角打到 +15°、t=1.8s τ踝 饱和 −120 N·m、CoM.x 跑到 +143mm）。
  //   ⇒ 先修矢状面，额度问题再谈；这里**回退到实测更稳的 200**。
  hip_l: 200,
  hip_r: 200,
  knee_l: 150,
  knee_r: 150,
  // ★ 踝：比膝小一个量级（踝在人类身上本来就只有膝的 1/5~1/4 力矩），
  //   45 N·m 足够做"勾脚/尖脚"，太大反而会让脚像弹簧一样抽。
  // ⚠ 这两个值**实际不生效**：踝走 `cfg.ankleTorque`（`skeleton.ts:1537` 的
  //   `/^(foot|ankle)_/` 分支），当前默认 **120** N·m —— 因为 45 实测太小。
  //   （原注释写"会被 cfg.ankleMaxTorque 覆盖"，但**那个配置项不存在**，
  //     曾据此误判"踝拿到的是脊柱的 120、是个 bug"。真名是 `ankleTorque`。）
  foot_l: 45,
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
  // ★★ 踝：**额状面自由度按单腿站立文献放宽**（2026-10-02）。
  //   X = 内翻/外翻（pronation/supination，绕足长轴）；Y = 轴向内外旋。
  //   原值 `[8, 6]` 的注释写"踝的侧向自由度不是走路的主自由度" —— 这在**双脚站立**
  //   成立，但**单腿站立恰恰相反**：
  //     · Liu et al., J Biomech 2012 —— "Unlike double-limb stance during which small
  //       body sway is found primarily in the sagittal plane, **single limb stance** showed
  //       the inter-joint coordination mainly in the **transverse** and **frontal** plane
  //       (ankle and hip internal/external rotations, **ankle inversion/eversion**)"
  //     · 同文给出额状面力学链："the whole body center of mass moves away from the
  //       supporting leg inducing a **lateral bending (hip abduction/adduction) moment
  //       that is equilibrated at the ankle level by supination or pronation of the ankle**
  //       that involves axial rotation"
  //     · 人体踝的被动 ROM：内翻 ~35°、外翻 ~14°；站立期功能性使用更小，
  //       取 **X=±14°（覆盖外翻全范围）/ Y=±10°** 作为可动上限。
  //   ⇒ 侧向自由度不是"放开就会乱翻"，而是**单腿平衡的必要执行器**。
  foot_l: [14, 10],
  foot_r: [14, 10]
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
  const soleLenTarget = 0.156 * cfg.height;
  const soleHalfLen = soleLenTarget / 2;
  const soleHalfThick = META.sole.thick * px2m / 2;
  const SOLE_WIDTH_TARGET = 0.1;
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
  const ARCH_SPEC = [];
  const ARCH_OUT = {
    archBlocks: [],
    archRise: 0,
    archCx: 0,
    archCz: 0,
    archMass: 0,
    archDims: { len: 0.081, rad: 7e-3, hh: 0.01 },
    mfootBlocks: [],
    mfootMass: 0,
    mfootCx: 0
  };
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
        centerY = (mapY(kn[1]) + mapY(ak[1])) / 2 - cfg.legStretch;
        centerZ = mapZ(kn[0], true);
      }
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
    let shinPlateUv;
    if (solePct > 0) {
      const soleMass = solePct / 100 * cfg.mass;
      const sfx = Math.max(0.1, cfg.soleFootScale);
      const side = spec.key === "shin_l" ? "l" : "r";
      const paw = LIMB_AXES.paw?.[side];
      const knee = LIMB_AXES.anchors?.[spec.key === "shin_l" ? "knee_l" : "knee_r"];
      const anklePx = LIMB_AXES.anchors?.[spec.key === "shin_l" ? "foot_l" : "foot_r"];
      const hxRaw = soleHalfLen * sfx;
      const hzRaw = (paw ? paw.lateralHalf * px2m : radius * 0.9) * sfx;
      const hx = hxRaw;
      const hz = SOLE_WIDTH_TARGET / 2 * sfx;
      const soleWorldY = soleHalfThick;
      const soleWorldZ = mapZ(knee ? knee[0] : part.cx, true);
      const soleMassTotal = mainMass + soleMass;
      if (anklePx && cfg.ankleEnabled) {
        const ankleY = mapY(anklePx[1]);
        const ankleZ = mapZ(anklePx[0], true);
        const fTilt = 0;
        const fYaw = restYawOf(spec.key === "shin_l" ? "foot_l" : "foot_r");
        const fQInv = invQuatOf(restQuatOf(fTilt, fYaw));
        const plateH = part.bh * px2m;
        const cutFrac = (() => {
          const texTopPx = part.cy - part.bh / 2;
          const cutPx = anklePx[1] - cfg.footCropUpMm / px2m;
          return Math.min(0.95, Math.max(0.02, 1 - (cutPx - texTopPx) / part.bh));
        })();
        const slack = Math.min(
          0.25,
          Math.max(cfg.footCropOverlapMm / plateH, cfg.footCropOverlapFrac * cutFrac)
        );
        const footUv = { x: 0, y: 0, width: 1, height: Math.min(1, cutFrac + slack) };
        const shinY = Math.max(0, cutFrac - slack);
        shinPlateUv = { x: 0, y: shinY, width: 1, height: 1 - shinY };
        const soleDrop = ankleY;
        const fMidY = soleWorldY;
        const yawDip = cfg.soleGroundCorr;
        const local2 = rotVecByQuat(fQInv, [0, fMidY - ankleY - SOLE_GROUND_CORR - yawDip, 0]);
        const midX = cfg.soleFootScale * hx * (cfg.forefootAtFrac * 2 - 1);
        const two = cfg.soleSplit;
        const hxBall = two ? hx * 0.5 : hx;
        const offBall = two ? hx * 0.5 : 0;
        const hzCol = hz * 0.5;
        const offColIn = +(hz * 0.5).toFixed(6);
        const offColOut = -(hz * 0.5).toFixed(6);
        bodies.push({
          key: spec.key === "shin_l" ? "foot_l" : "foot_r",
          bone: spec.bone,
          label: spec.key === "shin_l" ? "\u5DE6\u811A\u638C" : "\u53F3\u811A\u638C",
          part,
          // 贴图仍借小腿那张（下面裁出靴子那块）
          cx: 0,
          cy: ankleY,
          // ★ 对齐（用户 2026-10-04：「让脚部关节对称轴对着小腿的对称轴」）：
          //   脚掌刚体的横坐标必须用**小腿的对称轴 `centerZ`**，而不是素材实测的
          //   `ankleZ = mapZ(anklePx[0])` —— 后者带着"外八"的横向偏移（膝到踝不是铅垂），
          //   于是踝关节落在小腿中线之外，脚看着是歪的。
          //   偏航（外八）由 `restYawRad = restYawOf(...)` 单独表达，和位置无关。
          cz: centerZ,
          restTiltRad: fTilt,
          restYawRad: fYaw,
          // ★★★ 脚掌板：**从小腿贴图里裁出踝下方那块**（用户 2026-10-04：
          //   「把小腿的脚裁剪出来附着在脚上」）。
          //   裁剪边界用**实测的踝锚点**（`jointsMeta` 的 `foot_*`，画布 y=2792）
          //   与 `META.sole.len/thick`（素材实测）算，都不是猜的。
          // ⚠ 归一化按**整张贴图**（`META.parts[key].h`），THREE 的 uv 原点在左下，
          //     而素材坐标原点在左上 ⇒ y 要翻转。
          //
          // ★ `plateOffset` 必须把脚掌刚体原点（= **踝**）换算到 viewer 裁剪公式
          //   所假设的基准（= **原贴图中心**），否则脚掌板会被推到地面以下
          //   （实测脚埋进地下）。画布 y 向下、世界 y 向上，故取负号：
          //     plateOffset.y = mapY(part.cy) − mapY(anklePx[1])
          //                 = (anklePx[1] − part.cy) × px2m
          plateOffset: [0, (anklePx[1] - part.cy) * px2m, 0],
          plateUv: footUv,
          length: soleDrop,
          radius: 0,
          halfHeight: soleDrop / 2,
          mass: soleMass,
          // ★ 由下面的不变式后处理统一校准（见 assertColliderMass 上游）
          // ★★ 脚掌拆成「脚跟 + 前脚掌」两块碰撞体（用户 2026-10-04：「实在不行你自行对腿部纹理横向裁一刀」）。
          //   原因（实测）：单块刚性脚掌平放时，接触形心不会因倾转而移动 ——
          //   要让 CoP 移动只能把脚翻到边缘。而几何上正好卡在限位：
          //     半宽 hz=102mm，滚转 14° 使内侧缘抬9 hz·sin14°=25mm
          //     而脚半厚 hy=26mm → 刚好触边，实测 CoP 全程只动 4mm。
          //   拆成两块后，载荷可在两者之间**连续**转移
          //   ⇒ CoP 在足长范围内连续可调，不必翻脚。
          // ══════════════════════════════════════════════════════════════════
          // ★★★ 足骨架按**真实人脚形状**重建（2026-10-04）
          // ══════════════════════════════════════════════════════════════════
          //   之前是 **281×100×52mm 的等厚平板**（外八 25°）。两个致命问题：
          //     ① **内侧柱与外侧柱同时着地** ⇒ 载荷已在两柱上，接触求解器
          //        **没有可迁移的压力**。实测髋外展力矩 −120N→+120N 期间
          //        CoP_z 只动 **0.9mm**（内侧柱 175N : 外侧柱 12N = **14:1**）。
          //     ② 要卸载内侧柱得把 52mm 厚的板翘起来 ⇒ `tanθ > 52/100`
          //        ⇒ 需要 **>27.5°** 的中足行程，所需力矩超出前足质量能提供的量。
          //        实测：中足行程给到 55°、刚度 2000 N·m/rad，CoP_z 幅度恒为
          //        18~19mm 且随两者**零变化** ⇒ 柔性根本没参与。
          //
          //   **真实人脚不是平板** —— 关键在**内侧弓**：
          //     · Jeon & Cho 压力垫综述：「第一接触点通常在踝关节中心**外侧**，
          //       在**距下关节产生旋前力矩**，允许柔性活动」
          //       「**内侧弓把重量传递到足的外侧缘**」
          //     · Welte 2023：内侧弓的可动性是人类两足行走的演化产物
          //   ⇒ 仿人脚形状后**内侧弓天生离地** ⇒ 侧向 CoP 权限**白送**：
          //     给一点向外力，内侧柱本来就不承压，载荷立刻转到外侧缘。
          //   ⚠⚠⚠ **原注释此处写过一句错误的话**（2026-10-05 更正）：
          //   「弓本身就是拱形柔顺结构（承重压缩、离载回弹），**不需要额外的
          //   中足关节来模拟**」—— **这是假的**。拱形柔顺需要**形变能力**，
          //   而整只脚当时是**单个刚体**、形变能力为 0 ⇒ 内侧弓被硬编码离地
          //   22mm 之后**永远不可能接地**。实测（`tools/probe-footroll.ts`）：
          //   承重全在「足跟 + 外侧缘」，跖骨/趾 ≈ 0% ⇒ 支撑面退化成一条线
          //   ⇒ 侧向 CoP 无处可去 ⇒ 侧翻。
          //   ⇒ 真正的旋前自由度改由**弓刚体 + 弓关节**提供（见 archBlocks）。
          //
          //   比例（占足长百分比 / 绝对宽度 / 厚度），足长 = `2·L`：
          //     足跟  0–21%   宽 60mm   厚 26mm  全宽接地
          //     弓区 22–57%   外侧柱 30mm 厚 10mm 接地 · 内侧弓 30mm **离地 22mm**
          //     跖球 57–89%   宽 100mm（最宽）厚 20mm 全宽接地
          //     趾   89–100%  宽 76mm   厚 12mm  接地
          //   （100mm 宽 = `SOLE_WIDTH_TARGET`，符合 Millard 参考脚 30×10cm）
          // ══════════════════════════════════════════════════════════════════
          colliders: (() => {
            const archRise = cfg.archRise;
            const L = cfg.soleFootScale * hx;
            const HW = SOLE_WIDTH_TARGET / 2 * cfg.soleFootScale;
            const soleBottom = local2[1] - soleHalfThick;
            const blk = (fx0, fx1, fz0, fz1, hyMm, rise, label) => {
              const hy = hyMm / 1e3 * cfg.soleFootScale;
              const gap = (cfg.soleBlockGap ?? 0) / 2;
              const hxm = Math.max(1e-4, (fx1 - fx0) * L / 2 - gap);
              const hzm = Math.max(1e-4, (fz1 - fz0) * HW / 2 - gap);
              const cxm = (fx0 + fx1) / 2 * L, czm = (fz0 + fz1) / 2 * HW;
              const vol = 4 * hxm * hzm * hy;
              return {
                shape: "cuboid",
                halfHeight: 0,
                radius: 0,
                hx: hxm,
                hy,
                hz: hzm,
                offsetX: cxm,
                offsetY: soleBottom + hy + rise,
                offsetZ: czm,
                mass: vol,
                comY: 0,
                inertiaZ: 0,
                inertiaXY: 0,
                _vol: vol,
                _label: label
              };
            };
            const blocks = [
              blk(-1, -0.435, -0.6, 0.6, 26, 0, "\u8DB3\u8DDF"),
              blk(-0.435, 0.145, -1, -0.4, 10, 0, "\u5916\u4FA7\u67F1"),
              blk(0.145, 0.785, -1, 0, 20, 0, "\u8DD6\u9AA8\u5934\xB7\u5916\u4FA7"),
              blk(0.785, 1, -0.76, 0.76, 12, 0, "\u8DBE")
            ];
            const mfootBlocks = [
              blk(0.145, 0.785, 0, 1, 20, 0, "\u8DD6\u9AA8\u5934\xB7\u5185\u4FA7")
            ];
            if (cfg.flexibleArch === false) blocks.push(mfootBlocks[0]);
            const archBlocks = [
              blk(-0.435, -0.145, 0.4, 1, 20, archRise, "\u5185\u4FA7\u5F13\xB7\u540E"),
              blk(-0.145, 0.145, 0.4, 1, 20, archRise, "\u5185\u4FA7\u5F13\xB7\u524D")
            ];
            if (cfg.flexibleArch === false) blocks.push(...archBlocks);
            const archVol = archBlocks.reduce((a, b) => a + b._vol, 0);
            const mfootVol = mfootBlocks.reduce((a, b) => a + b._vol, 0);
            const archVolAll = cfg.flexibleArch === false ? 0 : archVol;
            const mfootVolAll = cfg.flexibleArch === false ? 0 : mfootVol;
            const allVol = archVolAll + mfootVolAll + blocks.reduce((a, b) => a + b._vol, 0);
            const archMass = soleMass * (archVolAll / allVol);
            const mfootMass = soleMass * (mfootVolAll / allVol);
            for (const [grp, gm] of [[archBlocks, archMass], [mfootBlocks, mfootMass]]) {
              const gv = grp.reduce((a, b) => a + b._vol, 0);
              for (const b of grp) {
                b.mass = gm * (b._vol / gv);
                b.inertiaZ = b.mass * (b.hx * b.hx + b.hy * b.hy) / 3;
                b.inertiaXY = b.mass * (b.hz * b.hz + b.hy * b.hy) / 3;
              }
            }
            ARCH_OUT.mfootBlocks = mfootBlocks;
            ARCH_OUT.mfootMass = mfootMass;
            ARCH_OUT.mfootCx = 0.145 * L;
            ARCH_OUT.archBlocks = archBlocks;
            ARCH_OUT.archRise = archRise;
            ARCH_OUT.archCx = (-0.435 + 0.145) / 2 * L;
            ARCH_OUT.archCz = (0.4 + 1) / 2 * HW;
            ARCH_OUT.archMass = archMass;
            {
              const aLo = [Infinity, Infinity, Infinity];
              const aHi = [-Infinity, -Infinity, -Infinity];
              for (const c of archBlocks) {
                const o = [c.offsetX ?? 0, c.offsetY ?? 0, c.offsetZ ?? 0];
                const h = [c.hx, c.hy, c.hz];
                for (let a = 0; a < 3; a++) {
                  aLo[a] = Math.min(aLo[a], o[a] - h[a]);
                  aHi[a] = Math.max(aHi[a], o[a] + h[a]);
                }
              }
              ARCH_OUT.archDims = {
                len: aHi[0] - aLo[0],
                rad: Math.max(aHi[1] - aLo[1], aHi[2] - aLo[2]) / 4,
                hh: (aHi[1] - aLo[1]) / 2
              };
            }
            const footMass = soleMass - ARCH_OUT.archMass - ARCH_OUT.mfootMass;
            const volTot = blocks.reduce((a, b) => a + b._vol, 0);
            for (const b of blocks) {
              const m = footMass * (b._vol / volTot);
              b.mass = m;
              b.inertiaZ = m * (b.hx * b.hx + b.hy * b.hy) / 3;
              b.inertiaXY = m * (b.hz * b.hz + b.hy * b.hy) / 3;
            }
            return blocks;
          })(),
          leg: true
        });
        if (cfg.flexibleArch !== false) {
          const isL = spec.key === "shin_l";
          const footKey = isL ? "foot_l" : "foot_r";
          const archKey = isL ? "arch_l" : "arch_r";
          bodies.push({
            key: archKey,
            bone: spec.bone,
            label: isL ? "\u5DE6\u5185\u4FA7\u5F13" : "\u53F3\u5185\u4FA7\u5F13",
            part,
            // ★★★ 体心必须与 `foot_*` **完全相同** ⇒ 用 `ankleY`，不是 `cy`。
            //   `cy` 是**小腿肚**中心（实测 236.5mm），`ankleY` 才是踝/脚掌中心
            //   （实测 68.6mm）—— 两者差 168mm。
            //   弓的 collider 偏移 `offsetY` 是按**鞋底平面**（体心下方 68.6mm）算的，
            //   一旦体心放到小腿肚上，弓就整体**浮到膝盖附近 190mm 高空**（实测）。
            //   后果：踝上多出一坨 0.123kg 的单摆 ⇒ 腿的动力学全变，
            //   表现为「脚在自身重量下上下弹 + 打滑」，但短期看着反而更稳
            //   （那坨质量在膝附近蹭到了地面，形成虚假支撑）。
            //   ⚠ 上面那段注释写的「与 foot_* 同一个几何中心（cx/cy/cz 全同）」
            //     在 `cy` 这一项上一直是**假的** —— 注释说了，做法没跟上。
            cx: 0,
            cy: ankleY,
            cz: centerZ,
            restTiltRad: tilt,
            restYawRad: yaw,
            plateHidden: true,
            plateOffset,
            // ★ 弓的 `length/radius/halfHeight` 必须用**弓自己**的尺寸，不能继承小腿的。
            //   这三个字段对弓的**物理**无用（弓的 collider 全是 `archBlocks`），
            //   但骨骼调试视图对**每个刚体**都画一个胶囊：
            //       new THREE.CapsuleGeometry(b.radius, b.halfHeight * 2, ...)
            //   继承小腿尺寸 ⇒ 在脚掉位置画出一个**小腿那么长的胶囊垂到地面**，
            //   用户见到“巨长的关节”。
            //   改成弓自己的包围盒：长 81mm、厚 20mm、宽 28mm。
            length: ARCH_OUT.archDims.len,
            radius: ARCH_OUT.archDims.rad,
            halfHeight: ARCH_OUT.archDims.hh,
            mass: ARCH_OUT.archMass,
            colliders: ARCH_OUT.archBlocks,
            leg: true
          });
          bodies.push({
            key: isL ? "mfoot_l" : "mfoot_r",
            bone: spec.bone,
            label: isL ? "\u5DE6\u5185\u4FA7\u524D\u8DB3" : "\u53F3\u5185\u4FA7\u524D\u8DB3",
            part,
            cx: 0,
            cy: ankleY,
            cz: centerZ,
            restTiltRad: tilt,
            restYawRad: yaw,
            plateHidden: true,
            // 靿子那张图由 foot_* 整张画，再画会出现「两只脚」
            plateOffset,
            length: ARCH_OUT.archDims.len,
            radius: ARCH_OUT.archDims.rad,
            halfHeight: ARCH_OUT.archDims.hh,
            mass: ARCH_OUT.mfootMass,
            colliders: ARCH_OUT.mfootBlocks,
            leg: true
          });
          const HWm = SOLE_WIDTH_TARGET / 2 * cfg.soleFootScale;
          const rollZ = centerZ + -0.7 * HWm;
          const rollY = ankleY + (ARCH_OUT.archBlocks[0].offsetY ?? 0) - ARCH_OUT.archBlocks[0].hy - ARCH_OUT.archRise;
          ARCH_SPEC.push({
            side: isL ? "l" : "r",
            footKey,
            archKey,
            // ⚠⚠ collider 的 `offsetX/Y/Z` 是**刚体局部**，世界位置 = 体心 + 偏移。
            //   直接当世界用会让锚点落到体心下方 263mm（`arch_l.C 局部 y=−263`）。
            //   这是本任务里第**三**次栽在“局部/世界混用”上（前两次：`wy=archRise`、
            //   `local[1]` 推导），所以这里把三个分量一次性写全。
            wx: 0,
            // 脚体 cx = 0
            wy: rollY,
            // 鞋底底面（旋前轴的高度）
            wz: rollZ,
            // 外侧接地棱（旋前轴的侧向位置）
            massFrac: ARCH_OUT.archMass / Math.max(1e-6, soleMass),
            // ★ 内侧前足接在弓的远侧端：弓的远端 fx = +0.145
            mfootKey: isL ? "mfoot_l" : "mfoot_r",
            mwx: ARCH_OUT.mfootCx,
            mwy: rollY,
            mwz: rollZ
          });
        }
        bodies.push({
          key: spec.key,
          bone: spec.bone,
          label: spec.label,
          part,
          cx: 0,
          cy,
          cz: centerZ,
          restTiltRad: tilt,
          restYawRad: yaw,
          plateOffset,
          // ★ 去掉底部那块靴子（它归脚掌板）⇒ 画面上只有一只脚，
          //   且两块拼回原图（uv 互补，见上面 footFrac 处的注释）。
          plateUv: shinPlateUv,
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
  for (const b of bodies) {
    if (!b.colliders || b.colliders.length === 0) continue;
    b.mass = b.colliders.reduce((a, c) => a + (c.mass ?? 0), 0);
  }
  const joints = [];
  const JOINT_ORDER_ACTIVE = JOINT_ORDER.filter((n) => cfg.ankleEnabled || !n.startsWith("foot_"));
  JOINT_ORDER_ACTIVE.forEach((name, index) => {
    const jm = jointMetaByName.get(name);
    if (!jm) throw new Error(`[skeleton] parts.json \u7F3A\u5C11\u5173\u8282 ${name}`);
    const isAnkle = jm.child === "foot_l" || jm.child === "foot_r";
    const isHip = /^hip_[lr]$/.test(jm.name);
    const childPart = PART_BY_KEY.get(jm.child) ?? PART_BY_KEY.get(isAnkle ? jm.parent : "");
    if (!childPart) throw new Error(`[skeleton] \u5173\u8282 ${name} \u7684\u5B50\u90E8\u4EF6\u5143\u6570\u636E\u4E0D\u5B58\u5728`);
    const [axPx, ayPx] = anchorPx(name, jm);
    const parent = byKey.get(attachTo(jm.parent, mapY(ayPx)));
    const child = byKey.get(jm.child);
    if (!parent || !child) throw new Error(`[skeleton] \u5173\u8282 ${name} \u7684\u521A\u4F53\u4E0D\u5B58\u5728`);
    const stanceHere = legKeys.has(jm.child);
    const wx = 0;
    const wz = isAnkle ? parent.cz : mapZ(axPx, stanceHere);
    const stretch = /^(knee|foot)_/.test(name) ? cfg.legStretch : 0;
    const wy = mapY(ayPx) - stretch * (legKeys.has(jm.parent) ? 1 : 0);
    const xy = JOINT_LIMITS_XY_DEG[name] ?? [20, 20];
    const flexMin = (isAnkle ? cfg.ankleLimitDeg[0] : jm.limitDeg[0]) * DEG;
    const flexMax = (isAnkle ? cfg.ankleLimitDeg[1] : jm.limitDeg[1]) * DEG;
    const tau = /^(foot|ankle)_/.test(name) ? cfg.ankleTorque : JOINT_MAX_TORQUE[name] ?? 100;
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
      // ★ 踝（foot_l/foot_r）走 revolute：自由转轴 = 局部 Z（= 屈伸，见 AXIS_* 约定）
      revoluteAxis: isAnkle ? [0, 0, 1] : void 0,
      // ★★ 髋**外展轴**用独立倍率（不动全局 `TORQUE_AXIS_FACTOR`，否则
      //   颈/肩/肘的外展轴会跟着变粗 —— 那三个的次要轴是**刻意压小**的，
      //   见 `JOINT_LIMITS_XY_DEG` 的注释）。
      //
      //   为什么撤掉"不超人"的余量（用户 2026-10-05 明确）：
      //   「人体骨骼承重很大的，不要设承重上限」。
      //   此前 hip=200 × 0.60 = **120 N·m**，而 Inman 1947 的静态需求
      //   （体重 × 半髋间距 = 687 × 0.163 = 112 N·m）就占掉 93% ——
      //   剩下 29% 余量不足以同时**托住**和**搬运**重心。
      //   2026-10-04 曾试 hip=250（外展 150）而无效，当时的判定是
      //   「矢状面没稳住，额度是假象」；现在额状机制（Winter 刚度伺服 +
      //   锁定承诺 + 载荷依赖张力）已就位，值得重测。
      //
      //   口径：髋外展轴取**与屈伸轴同量级**（1.00 而非 0.60），
      //   即 τmax(hip/0) = hip_l 的 τ = 200 N·m。
      //   ⚠ 这是**工程余量**，不是解剖上限；真实股骨/髋臼能承受的远高于此。
      maxTorque: [
        tau * (isHip ? cfg.hipAbdTorqueFactor : TORQUE_AXIS_FACTOR[0]),
        tau * TORQUE_AXIS_FACTOR[1],
        tau * TORQUE_AXIS_FACTOR[2]
      ]
    });
  });
  for (const as of ARCH_SPEC) {
    const parent = byKey.get(as.footKey);
    const child = byKey.get(as.archKey);
    if (!parent || !child) throw new Error(`[skeleton] \u5F13\u5173\u8282 ${as.archKey} \u7684\u521A\u4F53\u4E0D\u5B58\u5728`);
    const dParent = rotVecByQuat(
      invQuatOf(restQuatOf(parent.restTiltRad, parent.restYawRad)),
      [as.wx - parent.cx, as.wy - parent.cy, as.wz - parent.cz]
    );
    const dChild = rotVecByQuat(
      invQuatOf(restQuatOf(child.restTiltRad, child.restYawRad)),
      [as.wx - child.cx, as.wy - child.cy, as.wz - child.cz]
    );
    const tauArch = cfg.ankleTorque * 0.25;
    joints.push({
      name: as.archKey,
      index: joints.length,
      parentKey: as.footKey,
      childKey: as.archKey,
      wx: as.wx,
      wy: as.wy,
      wz: as.wz,
      parentLocal: dParent,
      childLocal: dChild,
      // 弓的静姿态与足体**相同**（建模时就是同姿态）⇒ 关节零位 = 素材姿势
      restRad: [0, 0, 0],
      minRad: [cfg.archLimitDeg[0] * DEG, -20 * DEG, -25 * DEG],
      maxRad: [cfg.archLimitDeg[1] * DEG, 20 * DEG, 25 * DEG],
      revoluteAxis: [1, 0, 0],
      maxTorque: [tauArch, tauArch, tauArch]
    });
    const mfoot = byKey.get(as.mfootKey);
    if (!mfoot) throw new Error(`[skeleton] \u5185\u4FA7\u524D\u8DB3 ${as.mfootKey} \u7684\u521A\u4F53\u4E0D\u5B58\u5728`);
    const mParent = rotVecByQuat(
      invQuatOf(restQuatOf(child.restTiltRad, child.restYawRad)),
      [as.mwx - child.cx, as.mwy - child.cy, as.mwz - child.cz]
    );
    const mChild = rotVecByQuat(
      invQuatOf(restQuatOf(mfoot.restTiltRad, mfoot.restYawRad)),
      [as.mwx - mfoot.cx, as.mwy - mfoot.cy, as.mwz - mfoot.cz]
    );
    joints.push({
      name: as.mfootKey,
      index: joints.length,
      parentKey: as.archKey,
      childKey: as.mfootKey,
      wx: as.mwx,
      wy: as.mwy,
      wz: as.mwz,
      parentLocal: mParent,
      childLocal: mChild,
      restRad: [0, 0, 0],
      minRad: [cfg.archLimitDeg[0] * DEG, -20 * DEG, -25 * DEG],
      maxRad: [cfg.archLimitDeg[1] * DEG, 20 * DEG, 25 * DEG],
      revoluteAxis: [1, 0, 0],
      maxTorque: [tauArch, tauArch, tauArch]
    });
  }
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

// tools/tmp-dump.ts
var sk = buildSkeleton(DEFAULT_CONFIG);
for (let i = 0; i < sk.joints.length; i++) console.log(i, sk.joints[i].name);
