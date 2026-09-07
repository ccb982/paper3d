// src/services/map/WaterMaterial.ts
import * as THREE2 from "three";

// src/services/map/TerrainMaterial.ts
import * as THREE from "three";

// src/services/map/PatchDecor.ts
var REGISTRY = /* @__PURE__ */ new Map();
function registerPatchDecor(def) {
  REGISTRY.set(def.fnId, def);
}
registerPatchDecor({
  fnId: "gravel",
  label: "\u788E\u5C51\u5751\u6D3C",
  params: {
    grainFreq: 52,
    // ① 碎粒频率（1/m，高频 hash 亮度抖动）
    grainAmp: 0.3,
    //    碎粒亮度幅度
    depressFreq: 9,
    // ② 塌陷斑频率（1/m，value noise 负偏置）
    depressDepth: 0.85,
    //   塌陷暗斑深度
    rimGain: 0.2,
    // ③ 碎屑堆缘微亮环
    bandEdge: 0.22
    // ④ 入坑带：碎屑渐入完成位置（u）→ 此后满强度直达坑底
  }
});

// src/services/map/TerrainMaterial.ts
var WALL_BRIGHTNESS = 2.9;
var WALL_NIGHT_DIRECT_FLOOR = 0.3;
var SUN_DIR_LOD_NEAR = 30;
var SUN_DIR_LOD_FAR = 90;
var SUN_DIR_MOD_MIN = 0.85;
var SUN_DIR_MOD_MAX = 1.2;
var WALL_DIRECT_DAY_FLOOR = 0.45;
var TERRAIN_DIRECT_DAY_FLOOR = 0.28;
var WALL_DECOR_GAIN = 0.5;
var MATERIAL_SLOTS = 32;
var MAT_FN_INDEX = {
  dirt: 0,
  brick: 1,
  grass: 2,
  wood: 3,
  rock: 4,
  moss: 5,
  water: 6,
  ice: 7,
  ash: 8,
  mud: 9,
  pit: 10,
  sand: 11,
  cement: 12,
  pebble: 13
};
var MATERIAL_DISPATCH = Object.entries(MAT_FN_INDEX).map(([fnId, idx]) => `    if (fn == ${idx}) return mat_${fnId}(f, w, id);`).join("\n");
var MATERIAL_GLSL = (
  /* glsl */
  `
  // ==================== \u6750\u8D28\u8F93\u5165\uFF08\u2605 \u5FC5\u987B\u5148\u58F0\u660E\u540E\u4F7F\u7528\uFF1B\u653E\u51FD\u6570\u5E93\u6700\u524D\uFF09 ====================
  uniform sampler2D uTileIds;
  uniform vec4 uMatBaseLCH[${MATERIAL_SLOTS}];
  uniform vec4 uMatJitter[${MATERIAL_SLOTS}];
  uniform vec4 uMatSurface[${MATERIAL_SLOTS}];
  uniform vec4 uMatEmissive[${MATERIAL_SLOTS}];
  uniform int uMatFn[${MATERIAL_SLOTS}];
  uniform float uMatParams[${MATERIAL_SLOTS * 16}];
  uniform float uMatLODEmissive[${MATERIAL_SLOTS}];
  uniform float uTime;   // \u52A8\u753B\u6750\u8D28\u65F6\u949F\uFF08\u79D2\uFF1BupdateTerrainLighting \u6BCF\u5E27\u5582\uFF0C\u9759\u6001\u6750\u8D28\u4E0D\u7528\uFF09

  // ==================== \u566A\u58F0\u57FA\u5EA7\uFF08\u7EAF\u89C6\u89C9\uFF0C\u65E0\u9700\u4E0E JS hash2 \u5BF9\u9F50\uFF09 ====================
  float h21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
               mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm2(vec2 p) {
    return vnoise2(p) * 0.6 + vnoise2(p * 2.3) * 0.3 + vnoise2(p * 5.1) * 0.1;
  }

  // \u2605 ES 1.00 \u4E0D\u5141\u8BB8\u7ED3\u6784\u4F53\u6570\u7EC4\u6210\u5458\u2014\u2014\u76F4\u63A5\u7528\u51FD\u6570\u8BFB\u53C2\u6570
  float matP(int id, int i) { return uMatParams[id * 16 + i]; }

  // ==================== OKLab \u4F2A\u9020\u6E32\u67D3\u5E93\uFF08\u611F\u77E5\u5747\u5300\u7A7A\u95F4\uFF0C\u89C1 colorLab.ts\uFF09 ====================
  // OKLab(L,a,b) \u2192 \u7EBF\u6027 RGB\u3002\u2605 \u8F93\u51FA linear\u2014\u2014ACES/colorspace_fragment \u5168\u5728 linear \u57DF\u3002
  vec3 oklab2linear(vec3 lab) {
    float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    float l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return vec3(
       4.0767416613 * l - 3.3077115904 * m + 0.2309699287 * s,
      -1.2684380041 * l + 2.6097574007 * m - 0.3413193963 * s,
      -0.0041960865 * l - 0.7034186145 * m + 1.7076147009 * s);
  }

  // \u591A\u5C3A\u5EA6\u7A7A\u95F4\u573A\uFF1A\u5927\u5C3A\u5EA6\u6591\u5757(patch) / \u4E2D\u9891\u6E10\u53D8(mid) / \u9AD8\u9891\u9897\u7C92(grain)\u3002
  // \u2605 \u5927\u4E16\u754C\u5750\u6807\u5148\u6298\u56DE\u539F\u70B9\u9632 mediump/highp \u7CBE\u5EA6\u635F\u5931\u3002
  const float SHADE_FIELD = 2048.0;
  vec3 shadeField(vec2 w) {
    w = w - floor(w / SHADE_FIELD) * SHADE_FIELD;
    return vec3(
      (fbm2(w * 0.04) - 0.5) * 2.0,
      (fbm2(w * 0.18) - 0.5) * 2.0,
       h21(floor(w * 30.0)) - 0.5);
  }

  // ==================== \u6750\u8D28\u51FD\u6570\uFF08\u8FD4\u56DE vec4(dL, dC, dH, reflect)\uFF09 ====================
  // f = (patch, mid, grain)\uFF1Bw = \u4E16\u754C\u5750\u6807\uFF1Bid = tile id\u3002
  // xyz \u5339\u914D LCH\uFF1A(L=\u660E\u6697, C=\u9971\u548C\u5EA6, H=\u8272\u76F8)\u3002
  // w = \u53CD\u5149\u5C42\u4E58\u6570\uFF081.0=\u65E0\u53D8\u5316\uFF1B0.85~1.15 \u8303\u56F4\uFF0C\u591A\u5C3A\u5EA6\u4EAE\u5EA6\u5C42\u6B21\uFF09\u3002

  // \u7EAF\u6CE5\u571F\u5730\u9762\uFF1A\u5927\u5C3A\u5EA6\u6591\u9A73 + \u8DEF\u8F99\u626B\u75D5\uFF08\u5404\u5411\u5F02\u6027\u6761\u75D5\uFF09+ \u5706\u5F62\u77F3\u5B50\uFF08\u6697\u70B9+\u4EAE\u8FB9\uFF09
  vec4 mat_dirt(vec3 f, vec2 w, int id) {
    float grain = (h21(floor(w * 80.0)) - 0.5) * matP(id, 0) * 1.5;
    float patchv = f.x * matP(id, 3) * 0.5;
    // \u8DEF\u8F99\u626B\u75D5\uFF1A\u6CBF x \u62C9\u4F38\u7684\u6761\u72B6\u660E\u6697\uFF08\u5404\u5411\u5F02\u6027\u566A\u58F0\uFF0C\u8F66\u8F99\u8D70\u5411\u611F\uFF09
    float ruts = (vnoise2(vec2(w.x * 0.8, w.y * 14.0)) - 0.5) * matP(id, 2) * 0.9;
    // \u77F3\u5B50\uFF1A0.5m \u683C\u5185\u7A00\u758F\u5706\u70B9\u2014\u2014\u6697\u6838 + \u5916\u5708\u5FAE\u4EAE\uFF08\u7ACB\u4F53\u611F\uFF09\uFF0C\u4E0D\u518D\u662F\u6574\u683C\u53D8\u6697
    vec2 pc = floor(w * 2.0);
    vec2 pf = fract(w * 2.0);
    float pseed = h21(pc + vec2(17.7, 3.3));
    vec2 ppos = vec2(0.25 + h21(pc + 1.1) * 0.5, 0.25 + h21(pc + 2.2) * 0.5);
    float pd = length(pf - ppos);
    float hasPeb = step(pseed, matP(id, 1));
    float peb = hasPeb * smoothstep(0.18, 0.06, pd) * -0.08;
    float pebRim = hasPeb * smoothstep(0.10, 0.20, pd) * smoothstep(0.32, 0.20, pd) * 0.03;
    float dL = patchv + ruts + grain + peb + pebRim;
    float dC = f.y * 0.004;
    float reflect = 1.0 + patchv * 0.40 + ruts * 0.20 + grain * 0.10 + peb * 0.6;
    return vec4(dL, dC, 0.0, reflect);
  }

  // \u7816\u77F3\u8DEF\u9762\uFF082026-09-07 \u91CD\u5199\uFF09\uFF1A\u4FDD\u7559\u9519\u7F1D\u780C\u6CD5\u7ED3\u6784\uFF0C\u4F46\u7070\u7F1D/\u6296\u52A8/\u53D8\u4F53/\u7834\u635F\u5168\u6536\u655B\u2014\u2014
  // \u539F\u53D8\u4F53 dH 0.4 + \u7070\u7F1D -0.30 \u662F"\u6761\u7EB9\u989C\u8272\u8FC7\u4E8E\u7A81\u51FA"\u7684\u5143\u51F6\u3002\u7F1D\u6D45\u3001\u8272\u504F\u5F31\u3001\u53CD\u5DEE\u5C0F\u3002
  vec4 mat_brick(vec3 f, vec2 w, int id) {
    float bw = 0.72, bh = 0.30;
    float row = floor(w.y / bh);
    float roff = h21(vec2(row, 1.7)) * 0.5 + mod(row, 2.0) * 0.5;
    float bx = w.x / bw + roff;
    float col = floor(bx);
    float lx = fract(bx), ly = fract(w.y / bh);
    vec2 bc = vec2(col, row);
    float jit = (h21(bc + vec2(13.1, 0.0)) - 0.5) * matP(id, 1) * 0.40;    // \xB10.02
    float variant = (h21(bc + vec2(29.3, 0.0)) - 0.5) * matP(id, 2) * 0.10; // \xB10.05 \u8FDE\u7EED\uFF08\u975E\u786C\u5207\uFF09
    float broken = h21(bc + vec2(41.7, 0.0)) < matP(id, 3) ? -0.05 : 0.0;
    float gw = matP(id, 0);
    float groutX = smoothstep(1.0 - gw, 1.0 - gw * 0.6, lx);
    float groutY = smoothstep(1.0 - gw, 1.0 - gw * 0.6, ly);
    float grout = max(groutX, groutY) * -0.12;
    float dL = jit + variant + broken + grout + f.y * 0.015;
    float dH = variant * 0.20;                 // \u539F 0.4 \u2192 \u6E29\u548C\u8272\u76F8\u504F
    float reflect = 1.0 + jit * 0.15 + grout * 0.12 + f.y * 0.08;
    return vec4(dL, f.y * 0.002, dH, reflect);
  }

  // \u8349\u5730\uFF082026-09-07 \u91CD\u5199\uFF1A\u4F4E\u566A\u4F4E\u5BF9\u6BD4\uFF0C\u5BF9\u9F50\u6C99\u571F\u65B9\u6CD5\u8BBA\uFF09\uFF1A\u7EAF\u8272\u4F4E\u9971\u548C\u7EFF\u5E95 +
  // \u5927\u5C3A\u5EA6\u8F6F\u660E\u6697 + \u4E2D\u9891\u8349\u4E1B\u8D77\u4F0F + \u6781\u5F31\u9897\u7C92\uFF1B\u5168\u90E8 vnoise \u8FDE\u7EED\uFF0C\u65E0\u786C\u5757\u65E0\u7EC6\u7C92\u7206\u70B8\u3002
  vec4 mat_grass(vec3 f, vec2 w, int id) {
    float patchv = (vnoise2(w * 0.20) - 0.5) * 2.0 * matP(id, 0) * 0.28;      // \u5927\u6591\u8F6F\u660E\u6697
    float tuft  = (vnoise2(w * 0.55 + 13.0) - 0.5) * 2.0 * matP(id, 1) * 0.12; // \u8349\u4E1B\u8D77\u4F0F
    float grain = (vnoise2(w * 2.2 + 29.0) - 0.5) * 2.0 * matP(id, 3) * 0.045;// \u8349\u53F6\u7EC6\u9897\uFF08\u6781\u5C11\uFF09
    float dry   = vnoise2(w * 0.10 + 71.0);
    float dL = patchv + tuft + grain;
    float dC = f.y * 0.003 - patchv * 0.012;   // \u5F31\u8272\u547C\u5438
    float dH = patchv * 0.006 + dry * 0.008;   // \u5927\u6591/\u67AF\u8349\u5FAE\u504F\u9EC4\uFF08\u6E29\u548C\uFF09
    float reflect = 1.0 + patchv * 0.12 + grain * 0.05;
    return vec4(dL, dC, dH, reflect);
  }

  // \u6728\u677F\u8DEF\u9762\uFF082026-09-07 \u91CD\u5199\uFF09\uFF1A\u4FDD\u7559\u6A2A\u677F\u6761\u4E3B\u9898\uFF0C\u53BB"\u786C"\u53BB"\u4EAE"\u2014\u2014\u677F\u7F1D -0.30\u2192-0.12\u3001
  // \u7AEF\u7F1D -0.22\u2192-0.10\u3001\u6728\u7EB9\u5E45\u5EA6\u51CF\u534A\u3001\u9489\u70B9\u538B\u6DE1\uFF1B\u6728\u7EB9\u65B9\u5411\u6027\u4FDD\u7559\u4F46\u4E0D\u518D\u523A\u773C\u3002
  vec4 mat_wood(vec3 f, vec2 w, int id) {
    float pw = max(matP(id, 0), 0.15);
    float row = floor(w.y / pw);
    float jit = (h21(vec2(row, 7.7)) - 0.5) * matP(id, 2) * 0.5;           // \xB10.03
    float seamOff = h21(vec2(row, 3.3)) * matP(id, 1) * 8.0;
    float ry = fract(w.y / pw);
    float band = max(ry, 1.0 - ry);                        // \u677F\u4E24\u7AEF = \u7F1D\u533A
    float seam = (1.0 - smoothstep(0.020, 0.040, band)) * -0.12;
    float seamX = abs(fract(w.x * 0.5 + seamOff) - 0.5);
    float endSeam = (1.0 - smoothstep(0.006, 0.020, seamX)) * -0.10;
    float grain = (vnoise2(vec2(w.x * 1.8, w.y * 50.0)) - 0.5) * matP(id, 3) * 0.32;
    float nail = 0.0;
    vec2 c = floor(w / 1.2);
    if (h21(c + vec2(88.3, 4.4)) < matP(id, 4)) {
      vec2 l = fract(w / 1.2) - 0.5;
      if (dot(l, l) < 0.004) nail = -0.12;
    }
    float dL = seam + endSeam + jit + grain + nail;
    float dH = (h21(vec2(row, 7.7)) - 0.5) * 0.012;
    float reflect = 1.0 + grain * 0.10 + seam * 0.06 + endSeam * 0.06;
    return vec4(dL, f.y * 0.002, dH, reflect);
  }

  // \u5CA9\u77F3\uFF1A\u5927\u7406\u77F3\u7EB9\uFF082026-09-07\uFF1A\u65E9\u524D\u5468\u671F sin \u5E26\u4E0E\u4E0D\u89C4\u5219\u566A\u58F0\u90FD"\u4E0D\u591F\u5927\u7406\u77F3"\uFF0C
  // \u6539\u7ECF\u5178\u810A\u7EBF\u7B97\u6CD5\u2014\u2014\u591A\u5C42\u5F02\u9891 FBM \u5F2F\u66F2\u7684\u7B49\u9AD8\u810A\u7EBF = \u767D\u8272\u5927\u7406\u77F3\u66F2\u7EB9\uFF0C
  // \u518D\u7531 streak \u63A7\u5236\u5F2F\u5EA6\u3001strata \u63A7\u5236\u5BC6\u5EA6\uFF1B\u7EAF\u89C6\u89C9\u65E0\u89C4\u5219\u91CD\u590D\uFF09\u3002
  vec4 mat_rock(vec3 f, vec2 w, int id) {
    // \u5927\u7406\u77F3\u5B9E\u5E95\uFF1A\u4F4E\u9891\u6696\u8272\u6591\uFF08\u77F3\u5934\u57FA\u8272\u8D77\u4F0F\uFF09
    float base = (fbm2(w * 0.35 + 3.0) - 0.5) * 0.16;
    // \u66F2\u7EB9\u573A\uFF1A\u4E24\u5C42\u5F02\u9891 FBM \u53E0\u52A0\u51FA\u5F2F\u66F2\u7EBF\u8DEF
    float v = fbm2(w * 1.4 + 7.0) + fbm2(w * 2.8 + 13.0) * 0.6 + fbm2(w * 5.6 + 21.0) * 0.35;
    // \u810A\u7EBF\uFF081 - |2v-1| \u2192 \u8D8A\u63A5\u8FD1\u6574\u65700/1 \u8D8A\u4EAE\uFF09\uFF0C\u518D smoothstep \u6536\u6210\u7EC6\u767D\u7EB9
    float ridge = 1.0 - abs(v * 2.0 - 1.0);
    // strata \u63A7\u5BC6\u5EA6\uFF08\u810A\u7EBF\u9608\u503C\uFF09\uFF0Cstreak \u63A7\u5F2F\u5EA6\uFF08\u566A\u58F0\u6270\u52A8\u5E45\u5EA6\uFF09
    float bend = (vnoise2(w * 1.1 + 41.0) - 0.5) * matP(id, 1) * 0.5;
    float vein = smoothstep(1.0 - matP(id, 0) * 0.5, 1.0, ridge + bend) * 0.16;
    // \u8F7B\u88C2\u7EB9\uFF08rid acclaimed \u7EBF\u72B6\u6697\u7EB9\uFF09
    float rn = fbm2(w * 1.3 + 27.0);
    float crackLine = 1.0 - abs(rn * 2.0 - 1.0);
    float crack = smoothstep(1.0 - matP(id, 2) * 0.4, 1.0, crackLine) * -0.06;
    // \u5FAE\u51F9\u51F8
    float bump = max(f.z, 0.0) * matP(id, 3) * 0.5;
    float dL = base + vein + crack + bump;
    // \u5927\u7406\u7EB9\u5FAE\u504F\u51B7\uFF08\u4EAE\u5EA6\u7EB9\u8DEF\u7ED9\u4E00\u70B9\u51B7\u767D\uFF0C\u5E95\u504F\u6696\u5F62\u6210\u5C42\u6B21\uFF09
    float dC = vein * 0.015;
    float reflect = 1.0 + vein * 0.10 + bump * 0.08;
    return vec4(dL, dC, 0.0, reflect);
  }

  // \u82D4\u85D3\uFF082026-09-07 \u91CD\u5199\uFF09\uFF1A\u4FDD\u7559\u82D4\u6591\u8986\u76D6\u5927\u5757\u8F6F\u8FB9\u4E3B\u9898\uFF0C\u5E45\u5EA6\u5168\u6536\u655B\u2014\u2014\u8986\u76D6\u538B\u6697
  // -0.13\u2192-0.06\u3001dC 0.06\u21920.025\u3001dH 0.02\u21920.010\u3001\u6EF4\u6C34\u75D5 -0.35\u2192-0.16\u3001reflect \u5F52\u4E00\u3002
  vec4 mat_moss(vec3 f, vec2 w, int id) {
    float covIn = f.x * 0.5 + 0.5 + f.y * 0.10;
    float cover = smoothstep(matP(id, 0), matP(id, 0) + max(matP(id, 1), 0.02) + 0.15, covIn);
    float fuzz = f.z * 0.03 * cover;
    float drip = (vnoise2(vec2(w.x * 1.5, w.y * 0.20)) - 0.5) * matP(id, 2) * 0.16;
    float stone = (1.0 - cover) * f.z * matP(id, 3) * 0.05;
    float dL = -cover * 0.06 + fuzz + drip + stone;
    float dC = cover * 0.025;
    float dH = cover * 0.010;                       // \u82D4\u533A\u5FAE\u504F\u7EFF\uFF08\u6E29\u548C\uFF09
    float reflect = 1.0 + cover * 0.12 + fuzz * 0.06 + drip * 0.08;
    return vec4(dL, dC, dH, reflect);
  }

  // \u6C34\u9762\uFF1A\u53CC\u5C42\u6D41\u52A8\u6CE2\u7EB9\uFF08uTime \u9A71\u52A8\u5E72\u6D89\uFF09+ ridged \u6CE2\u5CF0\u4EAE\u7EBF + \u6D45\u6C34\u6591 + \u95EA\u7CBC
  vec4 mat_water(vec3 f, vec2 w, int id) {
    float t = uTime * 0.35;
    float freq = 1.2 + matP(id, 1) * 2.0;
    float n1 = vnoise2(w * freq + vec2(t * 0.7, t * 0.4));
    float n2 = vnoise2(w * freq * 2.3 - vec2(t * 0.5, -t * 0.6));
    float wave = (n1 * 0.65 + n2 * 0.35 - 0.5) * 2.0;             // -1..1
    float dL = wave * matP(id, 0) * 0.10;
    // \u6CE2\u5CF0\u7EC6\u7EBF\uFF08ridged \u9608\u503C \u2192 \u4EAE\u8FB9\uFF09
    float crest = smoothstep(0.82, 1.0, 1.0 - abs(wave) * 0.9);
    // \u6D45\u6C34\u6591\uFF08\u5927\u5C3A\u5EA6\u9759\u6001\uFF0C\u900F\u5E95\u611F\uFF09
    float shallow = smoothstep(0.55, 0.90, fbm2(w * 0.25 + 5.0)) * matP(id, 3);
    // \u9633\u5149\u95EA\u7CBC\uFF1A\u9AD8\u9891\u70B9\u968F\u65F6\u95F4\u8F6E\u6362
    float glint = step(0.985, h21(floor(w * 6.0) + floor(t * 3.0))) * matP(id, 2);
    float dC = shallow * -0.02 + crest * 0.01;
    float reflect = 1.0 + wave * 0.18 + crest * 0.50 + shallow * 0.25 + glint * 0.8;
    return vec4(dL + shallow * 0.05 + glint * 0.06, dC, 0.0, reflect);
  }

  // \u6C34\u5E95\u9E45\u5375\u77F3\u6CB3\u5E8A\uFF082026-09-07 v4\uFF09\uFF1A\u8D34\u5408\u771F\u5B9E\u6CB3\u5E8A\u2014\u2014
  // \u5C0F\u800C\u5BC6\u3001\u78E8\u5706\u7684\u6241\u692D\u5706\u5375\u77F3\u76F8\u4E92\u7D27\u8D34\uFF08\u53E0\u74E6\u72B6\uFF09\uFF0C\u968F\u673A\u671D\u5411\u6253\u7834\u683C\u611F\uFF1B
  // \u77F3\u8272 = \u6696\u7070\u68D5\u591A\u77FF\u590D\u5408\uFF08\u9ED1/\u767D/\u571F\u9EC4/\u9EC4\u8910/\u7EA2\u68D5\uFF0C\u65E0\u84DD\u65E0\u9752\uFF09\uFF1B
  // \u77F3\u7F1D\u7EC6\u7802\u3001\u88AB\u6C34\u6D78\u6DA6\u7684\u6E7F\u6DA6\u5149\u6CFD\u3002\u65E0\u52A8\u753B\u3001\u9759\u6001\u3001reflect \u5F52\u4E00 \u2192 \u8212\u9002\u3002
  vec4 mat_pebble(vec3 f, vec2 w, int id) {
    float cs = 1.0 / max(matP(id, 0) * 140.0, 2.0);        // \u5375\u77F3\u683C\u5C3A\u5EA6\uFF08\u7C73\uFF09\uFF08\u9ED8\u8BA4 ~8cm\uFF09
    vec2 g = w / cs;
    vec2 gid = floor(g);
    vec2 lf = fract(g);
    // \u9010\u50CF\u7D20\u641C 3\xD73 \u90BB\u683C\uFF1A\u627E\u8986\u76D6\u672C\u50CF\u7D20\u7684\u692D\u5706\uFF08\u65CB\u8F6C+\u7F29\u653E \u2192 \u5355\u4F4D\u5706\u5224\u5B9A\uFF09
    float best = 1e9;
    float seedh = 0.0;
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        vec2 gi = gid + vec2(float(i), float(j));
        vec2 c = gi + (vec2(h21(gi + vec2(13.1, 7.7)), h21(gi + vec2(29.3, 17.1))) - 0.5) * matP(id, 1);
        float r1 = h21(gi + vec2(7.1, 3.3));
        float a = 0.50 + r1 * 0.16;                              // \u957F\u534A\u8F74\uFF08\u683C\u5355\u4F4D\uFF09
        float b = a * (0.55 + h21(gi + vec2(41.7, 7.7)) * 0.20); // \u77ED\u534A\u8F74\uFF08\u6241\u5706 1.5~1.8:1\uFF09
        float th = h21(gi + vec2(91.3, 5.5)) * 6.28318530718;    // \u968F\u673A\u671D\u5411
        vec2 d = lf - (c - gid);
        float cth = cos(th), sth = sin(th);
        vec2 q = vec2(d.x * cth - d.y * sth, d.x * sth + d.y * cth);
        float rr = (q.x / a) * (q.x / a) + (q.y / b) * (q.y / b);
        if (rr < best) { best = rr; seedh = h21(gi + vec2(63.1, 13.7)); }
      }
    }
    float stone = 1.0 - smoothstep(0.82, 1.04, best);   // \u692D\u5706\u9762\u63A9\u7801\uFF08\u8F6F\u8FB9\uFF09
    float dome = max(0.0, 1.0 - sqrt(best) * 0.95);     // \u77F3\u9762\u5FAE\u51F8\uFF08\u6E7F\u6DA6\u5706\u6DA6\u611F\uFF09
    float sh = seedh;
    float hueOff;
    float toneMul;
    if      (sh < 0.14) { hueOff = 0.00; toneMul = -0.9; }  // \u6DF1\u7070\u9ED1
    else if (sh < 0.36) { hueOff = 0.02; toneMul =  0.2; }  // \u571F\u9EC4
    else if (sh < 0.58) { hueOff = 0.05; toneMul =  0.5; }  // \u9EC4\u8910
    else if (sh < 0.76) { hueOff = 0.00; toneMul =  0.0; }  // \u7070
    else if (sh < 0.90) { hueOff = 0.03; toneMul =  0.9; }  // \u7EA2\u68D5
    else                { hueOff = 0.00; toneMul =  1.5; }  // \u6D45\u767D\u77F3
    float perTone = (seedh - 0.5) * matP(id, 2) * 2.0 + toneMul * matP(id, 2) * 0.5;
    float chroma = (sh < 0.14 || sh >= 0.90) ? 0.006 : 0.020 + seedh * 0.032;
    float grain = (h21(floor(w * 120.0)) - 0.5) * matP(id, 3) * 0.9;
    float dL = stone * (dome * 0.09 + perTone) - (1.0 - stone) * 0.07 + grain;
    float dC = stone * chroma;
    float dH = hueOff;
    float reflect = 1.0 + stone * (dome * 0.22 + perTone * 0.06);  // \u6E7F\u6DA6\u4E2D\u5FC3\u5149\u6CFD
    return vec4(dL, dC, dH, reflect);
  }

  // \u51B0\u9762\uFF082026-09-07 \u91CD\u5199\uFF09\uFF1A\u4FDD\u7559"\u51B0"\u7684\u9AD8\u53CD\u5149\u8FA8\u8BC6\uFF0C\u4F46\u53CD\u5DEE\u6536\u655B\u2014\u2014\u88C2\u7EB9 -0.10\u2192-0.05\u3001
  // \u971C\u6591 dC -0.4\u2192-0.12\u3001\u786C\u95EA\u70B9 step \u2192 \u4F4E\u9891\u67D4\u548C\u5FAE\u95EA\u3001reflect \u5F52\u4E00\u7ED9 ACES \u7559\u4F59\u91CF\u3002
  vec4 mat_ice(vec3 f, vec2 w, int id) {
    float rn = fbm2(w * 1.6);
    float crackL = 1.0 - abs(rn * 2.0 - 1.0);
    float crack = smoothstep(1.0 - matP(id, 0) * 0.25, 1.0, crackL) * -0.05;
    float depthv = (vnoise2(w * 0.30) - 0.5) * matP(id, 3) * 0.20;
    float frost = smoothstep(0.65, 0.88, vnoise2(w * 0.35 + 37.0)) * matP(id, 2) * 0.06;
    float shimmer = smoothstep(0.72, 0.95, vnoise2(w * 0.9)) * matP(id, 1) * 0.05;
    float dL = crack + depthv + frost + shimmer;
    float dC = -frost * 0.12;
    float reflect = 1.0 + crack * 0.30 + frost * 0.22 + depthv * 0.10 + shimmer * 0.14;
    return vec4(dL, dC, 0.0, reflect);
  }

  // \u7070\u70EC\u5730\uFF082026-09-07 \u91CD\u5199\uFF09\uFF1A\u98CE\u79EF\u6761\u7EB9/\u805A\u5806/\u7070\u7C92/\u4F59\u70EC\u5168\u6536\u655B\u2014\u2014\u539F grain \xB10.08+\u3001
  // \u4F59\u70EC reflect 1.5 \u662F\u566A\u70B9\u4E0E"\u8FC7\u66DD"\u6765\u6E90\uFF1B\u4F59\u70EC\u4EC5\u4FDD\u7559\u4F4E\u9891\u547C\u5438\u6696\u70B9\uFF0Creflect \u5F52\u4E00\u3002
  vec4 mat_ash(vec3 f, vec2 w, int id) {
    float drift = (vnoise2(vec2(w.x * 0.22, w.y * 0.9)) - 0.5) * matP(id, 3) * 0.35;
    float clump = (vnoise2(w * 0.50 + 17.0) - 0.5) * matP(id, 1) * 0.30;
    float grain = (h21(floor(w * 60.0)) - 0.5) * matP(id, 0) * 0.60;
    float t = uTime * 0.6;
    vec2 ec = floor(w * 2.0);
    float ember = 0.0;
    if (h21(ec + vec2(71.3, 13.7)) < matP(id, 2)) {
      float pulse = 0.55 + 0.45 * sin(t * (2.0 + h21(ec) * 3.0) + h21(ec + 7.7) * 6.28318530718);
      ember = pulse * 0.10;
    }
    float dL = drift + clump + grain + ember;
    float dC = ember * 0.20;
    float dH = ember * 0.012;                         // \u4F59\u70EC\u5FAE\u6696\uFF08\u6E29\u548C\uFF09
    float reflect = 1.0 + clump * 0.12 + ember * 0.30 + drift * 0.06 + grain * 0.04;
    return vec4(dL, dC, dH, reflect);
  }

  // \u6CE5\u6CBC\u5730\uFF082026-09-07 \u91CD\u5199\uFF09\uFF1A\u6C34\u6D3C/\u88C2\u7EB9/\u6E7F\u6DA6\u5168\u6536\u655B\u2014\u2014\u6C34\u6D3C\u6697 -0.10\u2192-0.05\u3001\u53CD\u5149
  // 0.55\u21920.25\u3001\u88C2\u7EB9\u5E45\u5EA6\u51CF\u534A\u3001\u9897\u7C92\u51CF\u6DE1\uFF1B\u6E7F\u9762\u89C2\u611F\u4FDD\u7559\u4F46"\u8212\u670D"\u3002
  vec4 mat_mud(vec3 f, vec2 w, int id) {
    float pn = vnoise2(w * 0.45 + 11.0);
    float puddle = smoothstep(1.0 - matP(id, 0), 1.05 - matP(id, 0) * 0.5, pn + 0.5);
    float rn = fbm2(w * 1.1 + 53.0);
    float crackL = smoothstep(0.88, 0.98, 1.0 - abs(rn * 2.0 - 1.0)) * matP(id, 1) * -0.06;
    float wet = (vnoise2(w * 0.28) - 0.5) * matP(id, 2) * 0.10;
    float grain = (h21(floor(w * 60.0)) - 0.5) * matP(id, 3) * 0.60;
    float dL = -puddle * 0.05 + crackL + wet + grain;
    float dC = puddle * 0.010;
    float reflect = 1.0 + puddle * 0.25 + wet * 0.10 + grain * 0.04;
    return vec4(dL, dC, 0.0, reflect);
  }

  // \u5751\u6D1E\uFF1A\u5F84\u5411\u6E10\u6DF1 + ridged \u88C2\u7EB9\uFF08\u88C2\u7EB9\u900F\u8B66\u793A\u7EA2\u5149\uFF09+ \u6697\u7C92
  vec4 mat_pit(vec3 f, vec2 w, int id) {
    vec2 c = fract(w * 0.25) - 0.5;                   // \u6BCF 4m \u4E00\u683C\u7684\u4E2D\u5FC3\u6E10\u6DF1
    float r = length(c) * 2.0;
    float depthv = (1.0 - smoothstep(0.0, 1.4, r)) * matP(id, 2) * -0.12;
    float rn = fbm2(w * 0.9 + 91.0);
    float crack = smoothstep(0.86, 0.97, 1.0 - abs(rn * 2.0 - 1.0)) * matP(id, 0) * -0.10;
    float glow = crack * matP(id, 1) * 0.5;           // \u88C2\u7EB9\u5FAE\u5149\uFF08\u504F\u7EA2\uFF09
    float grain = (h21(floor(w * 80.0)) - 0.5) * matP(id, 3) * 1.2;
    float dL = depthv + crack + grain;
    float dC = glow * 0.05;
    float dH = glow * 0.02;
    float reflect = 1.0 + depthv * 0.5 + glow * 0.8 + grain * 0.1;
    return vec4(dL, dC, dH, reflect);
  }

  // \u6C99\u571F\uFF081-7 \u5199\u5B9E\u98CE\u4E3B\u6253\uFF09\uFF1A\u7EAF\u8272\u57FA\u8C03\uFF0C\u989C\u8272\u53D8\u5316\u5168\u90E8\u7531\u8FDE\u7EED\u566A\u58F0\u573A\u63D0\u4F9B\u2014\u2014
  // \u2605 \u65E0\u6591\u5757/\u65E0\u77F3\u5B50/\u65E0\u626B\u75D5/\u65E0\u88C2\u7EB9/\u65E0\u683C\u5757\u3002\u4E09\u5C3A\u5EA6\u660E\u6697\uFF08\u5927\u6CE2/\u4E2D\u6CE2/\u7EC6\u7C92\uFF09
  //   + \u8272\u5F69\u547C\u5438\uFF08\u6697\u5904\u5FAE\u63D0\u9971\u548C\u504F\u51B7=\u6E7F\u6C99\u611F\uFF0C\u4EAE\u5904\u5FAE\u892A\u8272\u504F\u6696=\u5E72\u6C99\u611F\uFF09\uFF0C
  //   \u5168\u90E8 vnoise \u5E73\u6ED1\u8FDE\u7EED\uFF0C\u65E0\u4EFB\u4F55\u8FB9\u754C\u611F\u3002
  vec4 mat_sand(vec3 f, vec2 w, int id) {
    float macro = (vnoise2(w * 0.18) - 0.5) * 2.0 * matP(id, 2) * 0.50;  // \u5927\u6CE2\uFF08\u5927\u8303\u56F4\u660E\u6697\uFF09
    float meso  = (vnoise2(w * 0.75) - 0.5) * 2.0 * matP(id, 1) * 0.46;  // \u4E2D\u6CE2\uFF08\u56E2\u5757\u8D77\u4F0F\uFF09
    float grain = (h21(floor(w * 110.0)) - 0.5) * matP(id, 0) * 1.6;     // \u7EC6\u7C92\uFF08\u50CF\u7D20\u78E8\u7802\uFF09
    float dL = macro + meso + grain;
    // \u8272\u5F69\u547C\u5438\uFF1Ashade = \u660E\u6697\u573A\uFF08\u4E0D\u542B\u7EC6\u7C92\uFF0C\u4FDD\u6301\u5927\u56E2\u5757\u8272\u5F69\u6574\u4F53\u611F\uFF09
    float shade = macro * 0.6 + meso * 0.4;
    float dC = -shade * 0.028 * matP(id, 3);           // \u6697\u2192\u9971\u548C+\uFF08\u6E7F\uFF09\u4EAE\u2192\u892A\u8272\uFF08\u5E72\uFF09
    // \u2605 \u72EC\u7ACB\u8272\u76F8\u6F02\u79FB\u573A\uFF08\u4E0E\u660E\u6697\u89E3\u8026\uFF09\uFF1A\u571F\u58E4\u51B7\u6696\u6591\u9A73\uFF08\u504F\u9EC4\u6A59 \u2194 \u504F\u7EA2\u68D5\uFF09
    float hueDrift = (vnoise2(w * 0.22 + 31.0) - 0.5) * 2.0 * matP(id, 3) * 0.015;
    float dH = shade * 0.016 * matP(id, 3) + hueDrift; // \u6697\u2192\u504F\u51B7\u7070 \u4EAE\u2192\u504F\u9EC4\u6696 + \u6591\u9A73\u6F02\u79FB
    float reflect = 1.0 + dL * 0.18;
    return vec4(dL, dC, dH, reflect);
  }

  // \u6C34\u6CE5\uFF08\u88C5\u9970\u6027\u9AD8\u53F0\uFF09\uFF1A\u5E73\u6ED1\u54D1\u5149\u7070\u9762\u2014\u2014\u4E09\u5C3A\u5EA6\u8FDE\u7EED\u660E\u6697\u5E45\u5EA6\u8FDC\u5C0F\u4E8E\u6C99\u571F\uFF08\u566A\u70B9\u6709\u4F46\u4E0D\u8981\u591A\uFF09\u3002
  // \u53C2\u6570\uFF1Agrain(\u7EC6\u9897\u7C92)/meso(\u4E2D\u6CE2)/macro(\u5927\u6CE2)/chroma(\u8272\u5F69\u547C\u5438)\u3002
  // 2026-09-06 \u4E0E\u6C34\u6CE5\u53F0\u5EA7\u5B9E\u4F53\u540C\u6B3E\u54D1\u5149\u89C2\u611F\uFF1Areflect \u6052 1.0\uFF08\u4E0D\u505A\u4E58\u6027\u63D0\u5149\uFF0C
  // \u4E0D\u6CDB\u5149\u6CFD\uFF09\uFF1B\u8868\u9762\u65E0 specular/fresnel \u2192 \u79BB\u7EBF PBR \u822C\u6697\u6C89\u4F4E\u53CD\u5149\u3002
  vec4 mat_cement(vec3 f, vec2 w, int id) {
    float macro = (vnoise2(w * 0.18) - 0.5) * 2.0 * matP(id, 2) * 0.25;  // \u5927\u6CE2\u6781\u5F31
    float meso  = (vnoise2(w * 0.75) - 0.5) * 2.0 * matP(id, 1) * 0.35;  // \u4E2D\u6CE2\u5FAE\u8D77\u4F0F
    float grain = (h21(floor(w * 110.0)) - 0.5) * matP(id, 0) * 1.2;     // \u7EC6\u9897\u7C92\uFF08\u5C11\uFF09
    float dL = macro + meso + grain;
    float shade = macro * 0.6 + meso * 0.4;
    float dC = -shade * 0.020 * matP(id, 3);
    float hueDrift = (vnoise2(w * 0.22 + 31.0) - 0.5) * 2.0 * matP(id, 3) * 0.008;
    float dH = shade * 0.010 * matP(id, 3) + hueDrift;
    return vec4(dL, dC, dH, 1.0);       // \u2605 reflect \u6052 1.0\uFF1A\u54D1\u5149\u4E0D\u6CDB\u5149
  }

  // ==================== \u6761\u5E26\u88C5\u9970\uFF08\u300A\u6211\u753B\u7684\u7B2C\u4E00\u4E2A\u88C5\u9970\u6027\u7EB9\u7406\u300B2026-09-05 \u5B9A\u7A3F\uFF09 ====================
  // \u8BED\u4E49\uFF08\u7528\u6237\u5B9A\u8C03\uFF09\uFF1A\u89C4\u89C4\u77E9\u77E9\u7684\u6591\u9A6C\u7EBF\u5F0F\u6807\u7EBF\u2014\u2014\u6A2A\u5E73\u7AD6\u76F4 + \u8F7B\u78E8\u635F\u3002
  //   \xB7 \u6A21\u677F = \u7528\u6237\u624B\u7ED8 JSON\uFF1A\u53F3\u7F18\u7AD6\u5411\u8F66\u9053\uFF08\u4E2D\u5FC3 x\u22483.70m\uFF0C\u534A\u5BBD 0.10m\uFF09\u4E0A\u4E09\u6BB5
  //     \u865A\u7EBF\uFF08\u6CBF\u8F74 0.17~0.50 / 0.73~3.00 / 3.30~3.86m\uFF0C\u6309\u624B\u7ED8\u5750\u6807\u6362\u7B97\uFF09\uFF1B
  //   \xB7 \u4F4D\u7F6E\u56DB\u9009\u4E00 = \u6A21\u677F\u65CB\u8F6C 0\xB0/90\xB0/180\xB0/270\xB0 \u2192 \u8F66\u9053\u504F\u53F3/\u504F\u4E0A/\u504F\u5DE6/\u504F\u4E0B\uFF1B
  //   \xB7 \u51FA\u73B0\u6761\u5E26\u7684\u5730\u5757\u4E2D\uFF0C55% \u5355\u6761 / 45% \u4E24\u6761\u4E0D\u540C\u65CB\u8F6C\u53E0\u52A0\uFF1B
  //   \xB7 \u2605 20% \u5730\u5757\u51FA\u73B0\u6982\u7387\uFF08tileH \u95E8\u63A7\uFF09\uFF1B\u6C99\u571F\u5730\u5757\u4E13\u5C5E\uFF08TILE_FLAT_SAND \u58F0\u660E stripes\uFF09\uFF1B
  //   \xB7 \u989C\u8272 = \u7425\u73C0 sRGB(255,190,111) \u2192 OKLCH(0.846,0.122,0.196)\uFF1B
  //     \u78E8\u635F = \u8FB9\u7F18\u566A\u58F0\u5543\u8FB9\uFF080~3cm\uFF0C\u53EA\u8680\u4E0D\u80C0\uFF09+ \u5185\u90E8\u8F7B\u6591\u9A73\uFF080.88~1.0\uFF09\u3002
  // \u95E8\u63A7\uFF1AuMatParams slot15\uFF08stripes\uFF09=0 \u5173\uFF08\u65E9\u9000\u96F6\u6210\u672C\uFF09\uFF1B\u4EC5\u9876\u9762\u8C03\u7528\u3002
  // \u2605 reflect \u8D21\u732E\u6052 0\uFF1AoklchShade \u7684 sh = materialShade + stripeDeco + hazardDeco \u7684
  //   sh.w \u662F\u52A0\u6027\u7D2F\u79EF\uFF0C\u6750\u6599\u5DF2\u7EA6 1.0\uFF1B\u82E5\u53E0\u52A0\u4F1A\u8BA9\u88C5\u9970\u533A\u4EAE\u5EA6\xD72+ \u8FC7\u66DD\uFF0C\u88AB ACES \u62C9\u504F\u54C1\u7EA2\u3002
  vec4 stripeDeco(vec3 f, vec2 w, int id) {
    float amt = matP(id, 15);
    if (amt <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    vec2 wt = w - floor(w / 4096.0) * 4096.0;
    vec2 tc = floor(wt / 4.0);
    vec2 lp = wt - tc * 4.0;                            // \u5730\u5757\u5185\u5750\u6807 0..4m
    float tileH = h21(tc);                              // \u5730\u5757\u4E3B\u54C8\u5E0C
    if (tileH > 0.20) return vec4(0.0, 0.0, 0.0, 0.0);  // \u2605 20% \u51FA\u73B0\u6982\u7387
    float two = step(h21(tc + 3.9), 0.45);              // 45% \u53CC\u6761\u53E0\u52A0\uFF08\u72EC\u7ACB\u54C8\u5E0C\uFF09
    float k1 = floor(h21(tc + 7.3) * 4.0);              // \u65CB\u8F6C 0~3 \u56DB\u9009\u4E00
    float k2 = mod(k1 + 1.0 + floor(h21(tc + 13.7) * 3.0), 4.0); // \u7B2C\u4E8C\u6761\u65CB\u8F6C\u5FC5\u4E0D\u540C
    float mask = 0.0;
    for (int i = 0; i < 2; i++) {
      if (i == 1 && two < 0.5) break;
      float ki = i == 0 ? k1 : k2;
      vec2 d = lp - vec2(2.0);                          // \u4EE5\u5730\u5757\u4E2D\u5FC3\u4E3A\u539F\u70B9
      vec2 t = d;                                       // \u9006\u65CB\u8F6C\u56DE\u6A21\u677F\u7A7A\u95F4
      if (ki > 2.5)      t = vec2(-d.y, d.x);           // 270\xB0 \u2192 \u8F66\u9053\u504F\u4E0B
      else if (ki > 1.5) t = vec2(-d.x, -d.y);          // 180\xB0 \u2192 \u8F66\u9053\u504F\u5DE6
      else if (ki > 0.5) t = vec2(d.y, -d.x);           //  90\xB0 \u2192 \u8F66\u9053\u504F\u4E0A
      t += vec2(2.0);
      float aw = abs(vnoise2(t * 5.0 + ki * 23.7) - 0.5) * 0.06; // \u78E8\u635F\u91CF 0~3cm
      // \u8F66\u9053\uFF1A\u6A21\u677F\u53F3\u7F18\u7AD6\u5411 |t.x - 3.70| \u2264 0.10\uFF1B\u8FB9\u7F18\u88AB\u566A\u58F0\u5543\u8680\uFF08\u53EA\u8680\u4E0D\u80C0\uFF09
      float mLane = 1.0 - smoothstep(0.09 + aw, 0.11 + aw, abs(t.x - 3.70));
      // \u4E09\u6BB5\u865A\u7EBF\uFF08\u6CBF\u6A21\u677F\u8F74\uFF1B\u6BB5\u7AEF\u540C\u5543\u8680\uFF09
      float mDash = 0.0;
      mDash = max(mDash, smoothstep(0.14 + aw, 0.20 + aw, t.y) * (1.0 - smoothstep(0.47 - aw, 0.53 - aw, t.y)));
      mDash = max(mDash, smoothstep(0.70 + aw, 0.76 + aw, t.y) * (1.0 - smoothstep(2.97 - aw, 3.03 - aw, t.y)));
      mDash = max(mDash, smoothstep(3.27 + aw, 3.33 + aw, t.y) * (1.0 - smoothstep(3.83 - aw, 3.89 - aw, t.y)));
      mask = max(mask, mLane * mDash);
    }
    if (mask <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    vec3 base = uMatBaseLCH[id].xyz;
    vec3 amber = vec3(0.846, 0.122, 0.196);
    float weather = 0.88 + vnoise2(lp * 9.0) * 0.12;    // \u5185\u90E8\u8F7B\u6591\u9A73\uFF080.88~1.0\uFF09
    vec3 dd = (amber - base) * mask * amt * weather;
    return vec4(dd, 0.0);                                // \u989C\u8272\u53EA\u8D70 sh.xyz\uFF0C\u4E0D\u78B0\u4EAE\u5EA6
  }

  // ==================== \u8B66\u793A\u8D34\u753B\uFF08\u300A\u88C5\u9970\u6027\u7EB9\u7406\uFF0C\u8B66\u793A\u8D34\u753B\u300B2026-09-06 \u5B9A\u7A3F\uFF09 ====================
  // \u8BED\u4E49\uFF08\u7528\u6237\u5B9A\u8C03\uFF09\uFF1A\u5185\u90E8\u4E00\u4E2A\u65B9\u5F62\uFF08\u80CC\u666F\u8272\u9762\u677F\uFF09\uFF0C\u5916\u90E8\u4E00\u5708\u9ED1\u9EC4\u4EA4\u66FF\u7684\u6700\u7ECF\u5178 45\xB0
  // \u8B66\u793A\u7EBF\u6846\u3002\u94FA\u5728\u6C99\u571F\u5730\u5757\u9876\u9762\uFF1B\u4E0E\u6761\u5E26\u88C5\u9970\u540C\u6B3E\u968F\u673A\u6563\u5E03\uFF08~20% \u5730\u5757\u51FA\u73B0\uFF09\u3002
  //   \xB7 \u6A21\u677F = \u7528\u6237\u624B\u7ED8 JSON\uFF1A\u5C45\u4E2D\u65B9\u5F62 + \u5916\u5708\u8B66\u793A\u73AF\uFF08\u73AF\u539A ~0.5m\uFF09\u3002\u624B\u7ED8\u7EBF\u53EA\u662F\u793A\u610F\u3001
  //     \u5BC6\u5EA6\u4E0D\u8DB3\u2014\u2014\u5B8C\u6574\u6761\u7EB9\u5728\u6B64\u7A0B\u5E8F\u5316\u751F\u6210\uFF1A\u6BCF\u6761\u8FB9 ~13 \u6761\u9ED1\u9EC4\u5BF9\uFF08\u5468\u671F P=0.32m\uFF0C
  //     \u5355\u6761\u5782\u76F4\u5BBD ~0.11m\uFF09\uFF0C\u65E0\u9700\u9010\u6839\u624B\u753B\u3002
  //   \xB7 \u4E2D\u95F4\u8272 = \u80CC\u666F\u8272(\u539F\u59CB) RGB(255,164,92) \u8C03\u6697\u6210\u300C\u4E0D\u6562\u518D\u78B0\u7684\u505A\u65E7\u7070\u6A59\u300D
  //     OKLCH(\u22480.62,0.085,0.16)\u2014\u2014\u65E2\u6709\u5C42\u6B21\u53C8\u4E0D\u4F1A\u88AB ACES \u63A8\u6210\u54C1\u7EA2\uFF0C\u4E0E\u4EAE\u9EC4\u8B66\u793A\u6761\u62C9\u5F00\u3002
  //   \xB7 \u505A\u65E7\uFF08\u7528\u6237\u5B9A\uFF1A\u78E8\u635F\u505A\u65E7\uFF09\uFF1A\u5916\u5708\u7EC6\u9ED1\u63CF\u8FB9 ~2.5cm\uFF1B\u8B66\u793A\u73AF\u8FB9\u7F18\u566A\u58F0\u5543\u8680\uFF080~2cm\uFF0C
  //     \u53EA\u8680\u4E0D\u80C0\uFF09\uFF1B\u9EC4\u6761\u5185\u90E8\u8F7B\u6591\u9A73\uFF080.92~1.0\uFF09\uFF1B\u9ED1\u6761\u5FAE\u660E\u6697\uFF08\xB10.02 \u4E0D\u5446\u677F\uFF09\uFF1B
  //     \u6781\u6DE1\u659C\u5411\u522E\u75D5\uFF08\u7EA6\u4E00\u534A\u5730\u5757\u6709\uFF09\u3002
  //   \xB7 \u989C\u8272 = \u8B66\u793A\u9EC4 OKLCH(0.85, 0.175, 0.24) \u2248 sRGB(\u7EA6 255,197,0)\uFF1B\u9ED1 OKLCH(0.015,0,0)\u3002
  // \u2605 reflect \u8D21\u732E\u6052 0\uFF1AoklchShade \u7684 sh = materialShade + stripeDeco + hazardDeco \u7684
  //   sh.w \u662F\u52A0\u6027\u7D2F\u79EF\uFF0C\u6750\u6599\u5DF2\u7EA6 1.0\uFF1B\u82E5\u53E0\u52A0\u4F1A\u8BA9\u8D34\u753B\u533A\u4EAE\u5EA6\xD72+ \u8FC7\u66DD\uFF0C\u88AB ACES \u62C9\u504F\u54C1\u7EA2\u3002
  // \u95E8\u63A7\uFF1AuMatParams slot14\uFF08hazard\uFF09=0 \u5173\uFF08\u65E9\u9000\u96F6\u6210\u672C\uFF09\uFF1B\u4EC5\u9876\u9762\u8C03\u7528\uFF08topSurf>0.5\uFF09\u3002
  vec4 hazardDeco(vec3 f, vec2 w, int id) {
    float amt = matP(id, 14);
    if (amt <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    vec2 wt = w - floor(w / 4096.0) * 4096.0;
    vec2 tc = floor(wt / 4.0);                            // \u5730\u5757\u5750\u6807\uFF08\u54C8\u5E0C\u76D0\uFF09
    vec2 lp = wt - tc * 4.0;                              // \u5730\u5757\u5185\u5750\u6807 0..4m
float tileH = h21(tc + 7.31);                            // \u2605 \u72EC\u7ACB\u76D0\uFF1A~10% \u51FA\u73B0
    if (tileH > 0.10) return vec4(0.0, 0.0, 0.0, 0.0);
    float k = floor(h21(tc + 3.17) * 2.0);                // \u6761\u7EB9\u65B9\u5411\u53D8\u4F53\uFF080=\u2198 / 1=\u2197\uFF09
    vec2 d = lp - vec2(2.0);                              // \u4EE5\u5730\u5757\u4E2D\u5FC3\u4E3A\u539F\u70B9
    float q = max(abs(d.x), abs(d.y));                    // \u65CB\u8F6C\u65B9\u8DDD\uFF08\u6B63\u65B9\u5F62\uFF09
    const float OS = 1.55;                                // \u5916\u6846\u534A\u5BBD\uFF08\u8D34\u753B 3.1m\uFF09
    const float IS = 1.25;                                // \u5185\u90E8\u65B9\u5F62\u534A\u5BBD\uFF08\u80CC\u666F\u9762\u677F 2.5m\uFF09
    // \u505A\u65E7\u2460 \u8FB9\u7F18\u5543\u8680\uFF1A0~2cm\uFF08\u53EA\u8680\u4E0D\u80C0\uFF0C\u5916\u7F18\u5411\u5185\u7F29\uFF09
    float wear = abs(vnoise2(lp * 5.0 + k * 17.0) - 0.5) * 0.04;
    float mOut = 1.0 - smoothstep(OS - 0.005 - wear, OS + 0.005 - wear, q);
    if (mOut <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    // \u5916\u5708\u7EC6\u9ED1\u63CF\u8FB9\uFF1A\u8D34\u753B\u6700\u5916 ~2.5cm \u538B\u8FD1\u9ED1\uFF08q \u9760\u8FD1 OS \u5904\u4E3A 1\uFF0C\u753B\u5185\u90E8\u4E3A 0\uFF09
    float mOutline = mOut * smoothstep(OS - 0.032, OS - 0.008, q);
    // \u8B66\u793A\u73AF\u672C\u4F53\uFF08\u5185\u7F18 2cm \u8F6F\u8FC7\u6E21\uFF0C\u5916\u7F18\u8BA9\u51FA\u63CF\u8FB9\u5E26\uFF0C\u907F\u514D\u9ED1\u9EC4\u6761\u7EB9\u53E0\u5728\u63CF\u8FB9\u4E0A\u53D1\u9EC4\uFF09
    float mStripe = mOut * smoothstep(IS - 0.02, IS + 0.02, q)
                  * (1.0 - smoothstep(OS - 0.034, OS - 0.010, q));
    // \u5185\u90E8\u80CC\u666F\u9762\u677F
    float mIn = mOut * (1.0 - smoothstep(IS - 0.02, IS + 0.02, q));
    // 45\xB0 \u6761\u7EB9\uFF1A\u5BF9\u89D2\u5750\u6807 u\uFF0C\u5468\u671F P = \u4E00\u5BF9\u9ED1\u9EC4\uFF1B\u6BCF\u6761\u8FB9 ~2\xB7IS/P \u2248 13 \u5BF9
    float u = k < 0.5 ? d.x + d.y : d.x - d.y;
    const float P = 0.32;
    float fr = fract(u / P);
    float yellowF = 1.0 - smoothstep(0.44, 0.56, fr);     // \u534A\u5468\u671F\u9EC4 \u2192 \u9ED1
    // \u505A\u65E7\u2461 \u9EC4\u6761\u8F7B\u6591\u9A73 / \u9ED1\u6761\u5FAE\u660E\u6697 / \u5185\u90E8\u9762\u677F\u6591\u9A73
    float mottle = 0.92 + vnoise2(lp * 9.0 + k * 29.0) * 0.08;
    float blackJit = (vnoise2(lp * 7.0 + k * 41.0) - 0.5) * 0.04;   // \u9ED1\u6761\u5FAE\u660E\u6697 \xB10.02
    float inWear = 0.94 + vnoise2(lp * 9.0 + k * 31.0) * 0.06;      // \u5185\u90E8\u9762\u677F\u8F7B\u505A\u65E7
    // \u505A\u65E7\u2462 \u659C\u5411\u522E\u75D5\uFF1A\u7EC6\u7EBF\uFF0C\u7EA6\u4E00\u534A\u5730\u5757\u6709\uFF0C\u6781\u6DE1\u538B\u6697
    float scPresence = step(h21(tc + 19.7), 0.5);
    float scU = d.x * 1.4 + d.y * 1.4 + (vnoise2(lp * 2.0 + k * 7.0) - 0.5) * 0.8;
    float scWeight = smoothstep(0.980, 0.988, fract(scU)) * scPresence * 0.30;
    // \u76EE\u6807\u8272\u7EC4\u88C5\uFF08OKLab delta\uFF09\uFF1A\u73AF\u6761\u7EB9 + \u5185\u90E8\u80CC\u666F\u9762\u677F + \u63CF\u8FB9 + \u522E\u75D5
    vec3 base = uMatBaseLCH[id].xyz;
    vec3 yellow = vec3(0.85, 0.175, 0.24);                 // \u8B66\u793A\u9EC4
    vec3 black = vec3(0.015, 0.0, 0.0);                   // \u9ED1
    // \u5185\u90E8\u9EC4\u8272\u9762\u677F\uFF08\u624B\u7ED8\u6A21\u677F"\u7EB9\u7406\u5185\u90E8\u989C\u8272"= rgb(179,142,3) \u2192 OKLCH(0.6626,0.1348,0.2500)\uFF09
    vec3 interior = vec3(0.6626, 0.1348, 0.2500) * inWear;
    float worn = 1.0 + (mottle - 1.0) * yellowF + blackJit;
    vec3 target = mix(black, yellow, yellowF) * worn;
    vec3 dd = (target - base) * mStripe * amt;            // \u8B66\u793A\u73AF\uFF1A\u9ED1\u9EC4\u4EA4\u66FF\uFF08\u4E0D\u542B\u63CF\u8FB9\u5E26\uFF09
    dd += (interior - base) * mIn * amt;                  // \u4E2D\u95F4\u65B9\u5F62\uFF1A\u9EC4\u8272\u9762\u677F
    dd += (black * 0.85 - base) * mOutline * amt;         // \u5916\u5708\u63CF\u8FB9\u538B\u8FD1\u9ED1
    dd += (base * 0.9 - base) * scWeight * amt;           // \u522E\u75D5\u628A base \u538B\u6697 10%
    // \u2605 reflect \u8D21\u732E\u6052 0\uFF1AoklchShade \u91CC sh = materialShade + stripeDeco + hazardDeco \u7684
    //   sh.w \u662F\u52A0\u6027\u7684\uFF0CmaterialsShade \u5DF2\u7EA6 1.0\uFF1B\u8FD9\u91CC\u82E5\u518D\u52A0\u4F1A\u5BFC\u81F4\u8D34\u753B\u533A base\xD7~2 \u8FC7\u66DD\u504F\u54C1\u3002
    return vec4(dd, 0.0);                                  // \u989C\u8272\u53EA\u8D70 sh.xyz\uFF0C\u4E0D\u78B0\u4EAE\u5EA6
  }

  // ==================== \u5206\u53D1\uFF08\u6570\u636E\u9A71\u52A8\uFF1Atile\u2192\u6750\u8D28.fnId\u2192GLSL \u51FD\u6570\uFF09 ====================
  // materialShade \u8FD4\u56DE vec4(dL, dC, dH, reflect)\uFF1B\u65E0\u6750\u8D28 \u2192 \u96F6\u504F\u79FB + reflect=1.0\u3002
  vec4 materialShade(vec3 f, vec2 w, int id) {
    int fn = uMatFn[id];
${MATERIAL_DISPATCH}
    return vec4(0.0, 0.0, 0.0, 1.0);
  }

  // ==================== \u6536\u53E3\uFF1A\u57FA\u8272 + \u9010\u50CF\u7D20\u504F\u79FB + \u53CD\u5149\u5C42 \u2192 \u7EBF\u6027 RGB ====================
  // \u6BCF\u4E2A\u50CF\u7D20\u62FF\u5230\u81EA\u5DF1\u72EC\u7ACB\u7684 OKLab \u504F\u79FB\uFF08\u975E\u6574\u4F53\u7EDF\u4E00\u8C03\u8272\uFF09+ \u53CD\u5149\u5C42\u4E58\u6570\uFF1A
  //   materialShade \u7684\u5C3A\u5EA6\u6E10\u53D8 + \u6BCF\u5730\u5757 hash \u6296\u52A8\u65CF + \u53CD\u5149\u5C42\uFF0C\u53E0\u52A0\u5728\u4F5C\u8005\u4FA7\u57FA\u8272\u4E0A\u3002
  // topSurf\uFF1A1=\u9876\u9762\uFF08\u6761\u5E26\u88C5\u9970/\u8B66\u793A\u8D34\u753B\u542F\u7528\uFF09/ 0=\u4FA7\u58C1\uFF08\u5899\u9762\u5750\u6807\u7A7A\u95F4\u4E0D\u540C\uFF0C\u88C5\u9970\u4E0D\u6295\u5F71\uFF09\u3002
  vec3 oklchShade(vec2 w, int id, vec3 field, float topSurf) {
    vec4 sh = materialShade(field, w, id);                // (dL, dC, dH, reflect)
    if (topSurf > 0.5) {
      sh += stripeDeco(field, w, id);    // \u2605 \u6761\u5E26\u88C5\u9970\uFF08slot15 \u95E8\u63A7\uFF09
      sh += hazardDeco(field, w, id);    // \u2605 \u8B66\u793A\u8D34\u753B\uFF08slot14 \u95E8\u63A7\uFF09
    }
    // \u2605 \u9010\u5730\u5757\u8F7B\u5FAE HSL \u8272\u504F\uFF1A\u7C92\u5EA6 = 4\xD74m \u5730\u5757\uFF08\u6BCF\u5730\u5757\u6574\u4F53\u4E00\u4E2A hash \u8272\u504F\uFF0C
    //   \u5730\u5757\u5185\u90E8\u8FDE\u7EED\u7EAF\u8272\uFF09\u3002\u539F 1m \u7C92\u5EA6\uFF08floor(w)\uFF09\u4F1A\u788E\u6210\u5C0F\u65B9\u5757\u2014\u20142026-09-02
    //   \u7528\u6237\u53CD\u9988"\u7EB9\u7406\u4E0A\u6709\u65B9\u5757"\u540E\u5F52\u96F6\uFF1B\u73B0\u6309\u5730\u5757\u7C92\u5EA6\u6062\u590D"\u6BCF\u5730\u5757\u8F7B\u5FAE\u53D8\u5316"\u3002
    vec3 LCH = uMatBaseLCH[id].xyz + sh.xyz
             + uMatJitter[id].xyz * ((h21(floor(w / 4.0)) - 0.5) * 2.0);
    LCH.x = clamp(LCH.x, 0.0, 1.0);                        // L clamp\uFF08\u52FF mod\uFF09
    LCH.y = clamp(LCH.y, 0.0, 0.4);                        // C clamp\uFF08\u611F\u77E5\u4E0A\u9650\uFF09
    LCH.z = fract(LCH.z);                                  // H \u552F\u4E00\u53EF\u73AF\u7ED5
    vec3 lab = vec3(LCH.x, LCH.y * cos(LCH.z * 6.28318530718),
                           LCH.y * sin(LCH.z * 6.28318530718));
    vec3 base = oklab2linear(lab);                         // \u2192 linear \u5149\u7167\u7BA1\u7EBF
    return base * sh.w;                                   // \xD7 \u53CD\u5149\u5C42\u4E58\u6570\uFF08\u591A\u5C3A\u5EA6\u4EAE\u5EA6\u5C42\u6B21\uFF09
  }

  // ==================== \u4F2A PBR\uFF1A\u96F6\u989D\u5916\u566A\u58F0\u91C7\u6837\uFF08\u4ECE shadeField \u884D\u751F\uFF09 ====================
  // \u4F2A\u6CD5\u7EBF\uFF1Agrain \u6709\u9650\u5DEE\u5206 \u2192 \u5FAE\u9634\u5F71/\u5FAE\u9AD8\u5149\uFF082\u6B21 h21\uFF0C\u6781\u8F7B\u91CF\uFF09
  vec3 pseudoNormal(vec2 w) {
    float eps = 0.066;  // ~2\u683C\uFF08grain \u9891\u738730\uFF0C\u683C\u5BBD 0.033m\uFF09
    float gC = h21(floor(w * 30.0));
    float gR = h21(floor((w + vec2(eps, 0.0)) * 30.0));
    float gU = h21(floor((w + vec2(0.0, eps)) * 30.0));
    float dhdx = (gR - gC) / eps;
    float dhdz = (gU - gC) / eps;
    return normalize(vec3(-dhdx * 0.4, 1.0, -dhdz * 0.4));
  }
`
);
var FRAGMENT_MAIN = (
  /* glsl */
  `
        uniform sampler2D uAlbedo;
        uniform sampler2D uLightmap;
        uniform vec3 uSunDir;
        uniform vec2 uSunSide;
        uniform float uSunDay;
        uniform vec3 uAmbientColor;
        uniform vec3 uSunColor;
        varying vec2 vUv;
        varying vec2 vWorld;
        varying vec3 vColor;
        varying vec3 vNw;    // \u2605 \u4E16\u754C\u6CD5\u7EBF\uFF08\u9876\u9762 vertex \u540C\u540D varying\uFF09
        varying float vPw;   // \u2605 \u8865\u4E01\u6743\u91CD\uFF08\u8865\u4E01\u88C5\u9970\u7EB9\u7406\u9A71\u52A8\uFF09
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          // \u2605 \u8865\u4E01 = \u4E58\u6027\u7126\u571F\u67D3\u8272\uFF082026-09-05 \u5B9A\u6848\uFF09\uFF1A\u9876\u70B9\u8272 = \u4E58\u6570\uFF08\u767D=\u539F\u6837\u3001\u975E\u4E2D\u6027\u8272=
          //   \u70E7\u7126\u8C03\uFF09\u3002albedo \xD7 vColor \u4FDD\u7559\u7EB9\u7406\u660E\u6697/\u9897\u7C92 \u2192 "\u5730\u9762\u88AB\u70E7\u8FC7"\u800C\u975E\u6362\u7EB8\uFF1B
          //   \u4E58\u6570\u4EAE\u5EA6\u7531 PATCH_COLOR \u4FDD\u8BC1\uFF080.16 \u7EA7\u6DF1\u4E58\u4F1A\u5168\u9ED1\uFF1B\u6574\u5757\u66FF\u6362\u4F1A\u4E22\u7EB9\u7406\uFF09\u3002
          vec3 alb = texture2D(uAlbedo, vUv).rgb * vColor;
          vec3 lm = texture2D(uLightmap, vUv).rgb;      // r=\u76F4\u5C04 / g=AO
          int id = int(texture2D(uTileIds, vUv).r * 255.0 + 0.5);

          // \u591A\u5C3A\u5EA6\u7A7A\u95F4\u573A + OKLab \u9010\u50CF\u7D20\u504F\u79FB\u6536\u53E3 \u2192 \u7EBF\u6027 RGB \u57FA\u8272
          // \uFF08\u65E0\u6750\u8D28\u5730\u5757 uMatBaseLCH=\u767D\uFF08L1,C0,H0\uFF09\u2192 linear(1,1,1) \u2192 \xD7alb \u5373 alb\uFF09
          vec3 field = shadeField(vWorld);
    vec3 base = oklchShade(vWorld, id, field, 1.0);      // \u2605 \u9876\u9762\uFF1A\u6761\u5E26\u88C5\u9970\u542F\u7528

          // \u2605 4\xD74 \u5730\u5757\u8FB9\u754C\u63CF\u8FB9\uFF08\u9ED1\u8272\u5206\u754C\u7EBF\uFF09\uFF1A\u5757\u5185 UV \u8DDD\u8FB9 \u2192 \u5411\u8FD1\u9ED1\u6DF7\u5408
          //   \uFF082026-08-29 \u4E8C\u8C03\uFF1Aband 0.035 = \u6BCF\u5757\u8FB9\u7F18 14cm\uFF08\u76F8\u90BB\u5408\u62E2 ~28cm \u7EC6\u7F1D\uFF09\uFF0C
          //     \u5F3A\u5EA6 0.85 \u2248 \u5168\u9ED1\uFF1B\u7528\u6237\u8981\u6C42"\u66F4\u7EC6\u66F4\u9ED1"\uFF09
          vec2 buv = fract(vUv * 15.0);
          float dEdge = min(min(buv.x, 1.0 - buv.x), min(buv.y, 1.0 - buv.y));
          float edge = 1.0 - smoothstep(0.0, 0.010, dEdge);
          base = mix(base, vec3(0.02), edge * uMatSurface[id].w);

          // \u4F2A AO\uFF1A\u5927\u5C3A\u5EA6\u6591\u5757\u6697\u8C37\uFF08patch \u8D1F\u503C = \u8C37\u5730 = \u53D8\u6697\uFF1B0.4~1.0\uFF09
          float ao = smoothstep(-0.3, 0.3, field.x) * 0.6 + 0.4;

          // \u2605 \u9876\u9762\u76F4\u5C04\u4FDD\u5E95\uFF082026-09-05\uFF09\uFF1A\u6DF1\u5F71\u5217 lm.r\u22480.09 \u4E00\u6574\u7247\u584C\u9ED1\uFF08\u5761\u9762\u5C24\u5176\uFF09\u3002
          //   \u767D\u5929\u94B3\u5230 \u2265${TERRAIN_DIRECT_DAY_FLOOR.toFixed(2)}\uFF08\u89C1\u5E38\u91CF\u6CE8\u91CA\uFF0C\u5F71\u4ECD\u6697\u4E0D\u6B7B\u9ED1\uFF09\uFF1B
          //   \u591C\u665A\u4E0D\u4FDD\u5E95\uFF08\u591C\u666F = \u73AF\u5883\u5149\u5206\u5C42\uFF09\u3002uLightmap.B \u901A\u9053\u9884\u7559\u672A\u7528\u3002
          float d = mix(lm.r, max(lm.r, ${TERRAIN_DIRECT_DAY_FLOOR.toFixed(2)}), uSunDay);

          // \u2605 LOD \u5185\u5B9E\u65F6\u592A\u9633\u65B9\u5411\u91CD\u6620\u5C04\uFF082026-09-05 \u7528\u6237\u67B6\u6784\u51B3\u7B56\uFF1A\u9634\u5F71\u70D8\u7119\u4E00\u6B21\uFF0C
          //   LOD \u5185\u5B9E\u65F6\u7EF4\u62A4\u65B9\u5411\uFF09\u2014\u2014dirMod = N\xB7L / L.y\uFF1A\u5E73\u5730\u6052 1\uFF08\u4EAE\u5EA6\u5B88\u6052\uFF09\uFF0C
          //   \u5761\u9762\u65B9\u5411\u611F\u968F\u5B9E\u65F6\u592A\u9633\u65CB\u8F6C\uFF08\u671D\u9633\u5761>1 \u80CC\u5761<1\uFF0C\u5168\u5929\u4E1C\u5347\u897F\u843D\u53EF\u89C1\uFF09\uFF1B
          //   \u8DDD\u79BB 30m \u5185\u5168\u5F3A\u5EA6\u300190m \u5916\u5E73\u6ED1\u6DE1\u56DE\u7EAF\u70D8\u7119\uFF08\u8FDC\u573A\u4FDD\u6301\u9759\u6001\u9634\u5F71\u5F62\u72B6\uFF09\u3002
          //   clamp \u5E45\u5EA6\u9632\u80CC\u5149\u6B7B\u9ED1/\u987A\u5149\u8FC7\u66DD\u3002L \u63D0\u524D\u58F0\u660E\uFF08\u4E0B\u65B9\u955C\u9762\u9AD8\u5149\u5171\u7528\uFF09\u3002
          vec3 L = normalize(uSunDir);
          float dirMod = clamp(max(dot(vNw, L), 0.12) / max(L.y, 0.12),
            ${SUN_DIR_MOD_MIN.toFixed(2)}, ${SUN_DIR_MOD_MAX.toFixed(2)});
          float distCam = length(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
          float lodW = smoothstep(${SUN_DIR_LOD_FAR.toFixed(1)}, ${SUN_DIR_LOD_NEAR.toFixed(1)}, distCam);
          d *= mix(1.0, dirMod, lodW);

          // \u2605 \u8865\u4E01\u88C5\u9970\u6027\u7EB9\u7406\uFF08PatchDecor \xA7\u8865\u4E01\u5C5E\u6027\uFF09\uFF1A\u5751\u6D1E/\u88C2\u75D5\u5185\u90E8"\u5751\u5751\u6D3C\u6D3C"
          //   \u2014\u2014 \u788E\u7C92/\u584C\u9677\u6591\u968F\u8865\u4E01\u6743\u91CD\u6E10\u53D8\u3002\u2605 \u5FC5\u987B\u5728 lit \u4E58\u79EF\u4E4B\u524D\u4E58 alb
          //   \uFF082026-09-05 \u4FEE\uFF1A\u539F\u5148\u653E\u5728 lit \u4E4B\u540E\uFF0C\u4EAE\u5EA6\u4E58\u6570\u88AB\u541E \u2192 \u9876\u9762\u5751\u5E95\u566A\u70B9
          //   \u4E0D\u53EF\u89C1\uFF0C\u53EA\u6709\u4E58\u5E8F\u6B63\u786E\u7684\u4FA7\u58C1\u8DEF\u5F84\u751F\u6548\uFF09\uFF1B\u6CD5\u7EBF\u6270\u52A8\u5B58 tilt \u5F85 N \u521D\u59CB\u5316\u3002
          vec3 decorTilt = vec3(0.0);
          if (vPw > 0.001) {
            vec3 dec = patchDecor(vWorld, vPw);
            alb *= dec.x;
            decorTilt = vec3(dec.y, 0.0, dec.z);
          }

          vec3 lit = base * alb * (uAmbientColor * lm.g * ao + uSunColor * d);

          // ---- \u8868\u9762\u5C5E\u6027\uFF08\u4F2A PBR\uFF1A\u6CD5\u7EBF\u6270\u52A8 + \u7C97\u7CD9\u5EA6\u8C03\u5236\uFF09 ----
          vec3 N = pseudoNormal(vWorld);                   // \u5FAE\u9634\u5F71/\u5FAE\u9AD8\u5149
          if (vPw > 0.001) N = normalize(N + decorTilt);   // \u8865\u4E01\u4F2A\u6CD5\u7EBF\u6270\u52A8
          float rough = uMatBaseLCH[id].w + field.z * 0.15;  // \u6750\u8D28\u57FA\u7840 + grain \u8C03\u5236
          vec3 V = normalize(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
          float spec = uMatSurface[id].x;
          if (spec > 0.001) {
            vec3 H = normalize(L + V);
            float power = mix(48.0, 8.0, rough);          // \u7C97\u7CD9\u2192\u6A21\u7CCA\u9AD8\u5149\uFF0C\u5149\u6ED1\u2192\u9510\u5229
            lit += uSunColor * spec * pow(max(dot(N, H), 0.0), power);
          }
          float fres = uMatSurface[id].y;
          if (fres > 0.001) {
            lit += fres * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.30;
          }
          float emis = uMatSurface[id].z;
          if (emis > 0.001) {
            lit += uMatEmissive[id].rgb * emis * (0.92 + 0.08 * h21(vUv * 512.0));
          }
          // ---- LOD \u9AD8\u53F0\u53D1\u5149\uFF08\u5B9E\u65F6\u6E32\u67D3\u5C42\uFF0C\u589E\u5F3A\u7248\uFF09----
          //   \u76EE\u6807\uFF1A\u76F8\u673A\u8C03\u6574\uFF08\u4FEF\u77B0/\u5E73\u79FB/\u8F6C\u8EAB\uFF09\u65F6\u80FD\u660E\u663E\u770B\u5230\u5404\u5730\u5757\u7684\u53D1\u5149\u5C42\u6B21\u53D8\u5316\u3002
          //   \u4E09\u5C42\u8C03\u5236\u53E0\u52A0\uFF1A
          //     distBand \u8DDD\u79BB\u5E26\u72B6\u547C\u5438\uFF08\u591A\u4E2A\u8DDD\u79BB\u73AF\u5E26 \u2192 \u4FEF\u77B0\u65F6\u533A\u5757\u660E\u663E\u5206\u5C42\uFF09
          //     glance   \u955C\u5934\u63A0\u5C04\u89D2\uFF08\u4FA7\u9762\u63A0\u5C04\u66F4\u4EAE\uFF09
          //     sunLayer \u592A\u9633\u65B9\u4F4D\u5206\u5C42\uFF08\u8F6C\u5411\u592A\u9633\u4FA7\u660E\u663E\u4EAE\u8D77 \u2192 \u76F8\u673A\u8F6C\u52A8\u53EF\u89C1\u5DEE\u5F02\uFF09
          float lodE = uMatLODEmissive[id];
          if (lodE > 0.001) {
            float dist  = length(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
            vec2 toCam  = cameraPosition.xz - vWorld;
            float toCamL = max(length(toCam), 1e-4);

            // \u2460 \u8DDD\u79BB\u5E26\u72B6\u547C\u5438\uFF1A\u591A\u73AF\u5E26\u952F\u9F7F \u2192 \u4FEF\u77B0\u65F6\u90BB\u8FD1\u533A\u57DF\u51FA\u73B0\u660E\u6697\u73AF\u5E26\uFF0C\u79FB\u52A8\u660E\u663E
            //   \uFF08chunk=60m/LOD_RANGES=20,40,60 \u5BF9\u9F50\uFF1A\u4E3B\u5E26 0/20/40/60 \u9000\u7F29\u73AF\uFF09
            float ring1 = smoothstep(60.0, 12.0, dist);       // \u4E3B\u53D1\u5149\u5E26\uFF08\u8FDC\u2192\u8FD1\u4EAE\u8D77\uFF09
            float ring2 = smoothstep(40.0, 28.0, dist) * 0.6; // \u6B21\u5E26\u53E0\u52A0
            float ring3 = smoothstep(22.0, 14.0, dist) * 0.4; // \u8FD1\u8DDD\u5FAE\u5E26
            float distBand = clamp(ring1 + ring2 + ring3, 0.0, 1.6);

            // \u2461 \u63A0\u5C04\u589E\u5F3A\uFF1A\u964D\u5F97\u8D8A\u591A\uFF08\u8D8A\u4FEF\u89C6\uFF09\u63A0\u5C04\u89D2\u8D8A\u5927\u8D8A\u4EAE\uFF0C\u4FA7\u770B/\u4FEF\u77B0\u5E73\u53F0\u660E\u663E
            float zoneX = length(toCam);
            float glance = 0.45 + 0.55 * clamp(zoneX / max(dist, 0.001), 0.0, 1.0);

            // \u2462 \u592A\u9633\u65B9\u4F4D\u5206\u5C42\uFF08\u589E\u5F3A\uFF09\uFF1A\u671D\u5411\u592A\u9633\u4FA7 + \u968F\u663C\u591C\u52A0\u5F3A\uFF1B\u8F6C\u52A8\u76F8\u673A\u4EAE\u9762\u626B\u8FC7
            float sunLayer = 0.5 + 0.9 * dot(toCam / toCamL, uSunSide) * uSunDay;
            sunLayer = clamp(sunLayer, 0.0, 1.0);

            // \u2463 \u9759\u6001\u7A7A\u95F4\u6296\u52A8\uFF08\u5730\u5757 id \u7EA7\uFF09\uFF1A\u8BA9\u76F8\u90BB\u5E73\u53F0\u53D1\u5149\u5F3A\u5EA6\u4E0D\u4E00\u81F4\uFF0C\u5DEE\u5F02\u53EF\u89C1
            float idJit = 0.75 + 0.5 * h21(floor(vWorld * 0.25));

            // \u4EAE\u5EA6\u589E\u5F3A\u4E3B\u8981\u53CD\u5C04\u5C42\uFF1A\u57FA\u8272 \xD7 \u5F3A\u4E58\u6570\uFF08\u539F max\u22480.025 \u2192 \u73B0\u53EF\u8FBE ~1.0+\uFF09
            lit += base * lodE * 18.0 * distBand * glance * sunLayer * idJit;
          }

          gl_FragColor = vec4(lit, 1.0);
          #include <tonemapping_fragment>   // \u2605 \u4E0E\u5168\u5C40 ACES \u7BA1\u7EBF\u5BF9\u9F50\uFF08\u7F3A\u4E86\u4F1A\u504F\u8272\uFF09
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `
);
var wallRegistry = /* @__PURE__ */ new Set();
function registerWallLightTarget(m) {
  wallRegistry.add(m);
}
function unregisterWallLightTarget(m) {
  wallRegistry.delete(m);
}
var WALL_FRAG = (
  /* glsl */
  `
  uniform sampler2D uAlbedo;
  uniform sampler2D uLightmap;
  uniform vec3 uAmbientColor;
  uniform vec3 uSunColor;
  uniform float uSunDay;       // 0..1 \u767D\u663C\u5EA6\uFF08\u591C\u665A\u76F4\u5C04\u4FDD\u5E95\u5F00\u5173\uFF09
  uniform float uWallEmissive; // \u4FA7\u58C1\u81EA\u53D1\u5149\u4FDD\u5E95\uFF08\u591C\u665A >0\uFF1B\xD7 \u6750\u8D28\u672C\u8272\uFF09
  uniform vec3 uSunDir;        // \u2605 \u5B9E\u65F6\u592A\u9633\u65B9\u5411\uFF08LOD \u5185\u65B9\u5411\u91CD\u6620\u5C04\u7528\uFF09
  varying vec2 vUv;
  varying vec2 vUvC;
  varying vec2 vTex;
  varying vec3 vColor;   // \u2605 \u8865\u4E01\u8272\u901A\u9053\uFF08\u4E58\u6027\u67D3\u8272\uFF1B\u767D=\u539F\u6837\uFF09
  varying vec3 vNw;      // \u2605 \u4E16\u754C\u6CD5\u7EBF\uFF08WALL_VERT \u540C\u540D varying\uFF09
  varying vec3 vWpos;    // \u2605 \u4E16\u754C\u5750\u6807\uFF08LOD \u8DDD\u79BB\u8870\u51CF\u7528\uFF09
  varying float vPw;     // \u2605 \u8865\u4E01\u6743\u91CD\uFF08\u8865\u4E01\u88C5\u9970\u7EB9\u7406\u9A71\u52A8\uFF09
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    int id = int(texture2D(uTileIds, vUv).r * 255.0 + 0.5);
    bool isWaterWall = (id == 4);   // \u2605 \u6C34\u4F53\u4FA7\u58C1\uFF08id 4 = water\uFF09\u72EC\u7ACB\u8DEF\u5F84

    // \u2605 \u5149\u7167/\u88C5\u9970\u91C7\u6837\u70B9\uFF082026-09-02 \u4FEE\u6B63"\u4FA7\u58C1\u4E0E\u9876\u90E8\u989C\u8272\u4E0D\u4E00\u81F4"\uFF09\uFF1A
    //   \u5899\u9762\u662F\u7AD6\u76F4\u9762\uFF0CvUvC\uFF08xz \u6295\u5F71\uFF09\u584C\u7F29\u5230\u5899\u811A\u7EBF\u4E00\u4E2A\u70B9\u2014\u2014\u70D8\u7119\u5149\u56FE\u91CC\u5899\u811A\u662F
    //   AO/\u9634\u5F71\u6DF1\u533A\uFF0C\u6574\u9762\u5899\u53D6\u5230"\u5751\u5E95\u5149\u7167"\uFF0C\u518D\u9760 2.9 \u589E\u76CA\u62C9\u4EAE \u2192 \u4E0E\u9876\u9762\u7CFB\u7EDF\u6027
    //   \u8272\u504F\u3002\u6539\u4E3A\u975E\u6C34\u5899\u91C7\u6837 vUv\uFF08\u5899\u9876\u6240\u5C5E\u5730\u5757\u4E2D\u5FC3\uFF0C\u4E0E uTileIds \u540C\u6E90\uFF09\u2014\u2014
    //   \u5149\u7167\u4E0E\u9876\u9762\u540C\u6E90\u540C\u503C\uFF0CwallGain \u56DE\u5F52 1.0\uFF0C\u989C\u8272\u81EA\u7136\u4E00\u81F4\uFF08\u5899 = \u9876\u9762\u5EF6\u5C55\uFF09\u3002
    //   \u6C34\u5899\u4FDD\u6301\u5899\u811A\u6295\u5F71 + \u4F4E\u589E\u76CA\uFF08\u6DF1\u6697\u6C34\u9762\u89C2\u611F\u662F\u4E13\u8C03\u6548\u679C\uFF09\u3002
    // \u2605 \u8865\u4E01 = \u4E58\u6027\u7126\u571F\u67D3\u8272\uFF08\u4E0E\u9876\u9762\u540C\u6B3E\uFF1Aalbedo \xD7 vColor\uFF0C\u4FDD\u7559\u5899\u9762\u7EB9\u7406\u7EC6\u8282\uFF09
    vec3 alb = texture2D(uAlbedo, isWaterWall ? vUvC : vUv).rgb * vColor;
    vec3 lm = texture2D(uLightmap, isWaterWall ? vUvC : vUv).rgb;
    vec3 field = shadeField(vTex);
    vec3 base = oklchShade(vTex, id, field, 0.0);       // \u2605 \u4FA7\u58C1\uFF1A\u6761\u5E26\u88C5\u9970\u4E0D\u6295\u5F71

    // \u2605 \u8865\u4E01\u88C5\u9970\u6027\u7EB9\u7406\uFF08PatchDecor\uFF09\uFF1A\u5751\u58C1\u788E\u5C51\u5751\u6D3C\uFF08\u4EAE\u5EA6\u4E58\u6570\uFF1B\u5899\u9762\u65E0\u955C\u9762/
    //   \u83F2\u6D85\u5C14\u9879\uFF0C\u4F2A\u6CD5\u7EBF\u6270\u52A8\u65E0\u843D\u70B9\u2014\u2014\u4E14 dirMod \u7528\u5B8F\u89C2\u6CD5\u7EBF\u4FDD\u6301\u671D\u9633/\u80CC\u9633\u65B9\u5411
    //   \u611F\uFF0C\u4E0D\u505A\u5FAE\u6270\uFF09\u3002w = vTex\uFF08\u5899\u9762 (\u6CBF\u5899\u8DDD, \u9AD8)\uFF0C\u89C1 PatchDecor \u6CE8\u91CA\uFF09\u3002
    //   \u5899\u589E\u76CA WALL_DECOR_GAIN=0.5\uFF082026-09-05 \u7528\u6237\uFF1A\u4FA7\u58C1\u524A\u5F31\uFF0C\u5751\u5E95\u6EE1\u5F3A\u5EA6\uFF09\u3002
    if (vPw > 0.001) {
      alb *= mix(1.0, patchDecor(vTex, vPw).x, ${WALL_DECOR_GAIN});
    }

    // \u2605 4\xD74 \u5730\u5757\u8FB9\u754C\u63CF\u8FB9\uFF08\u4E0E\u9876\u9762\u540C\u6B3E\uFF1A\u5206\u754C\u7EBF\u5728\u5899\u9762\u4E0A\u5EF6\u5C55\uFF09
    vec2 buv = fract((isWaterWall ? vUvC : vUv) * 15.0);
    float dEdge = min(min(buv.x, 1.0 - buv.x), min(buv.y, 1.0 - buv.y));
    float edge = 1.0 - smoothstep(0.0, 0.010, dEdge);
    base = mix(base, vec3(0.02), edge * uMatSurface[id].w);

    // \u4F2A AO\uFF1A\u5927\u5C3A\u5EA6\u6591\u5757\u6697\u8C37\uFF08patch \u8D1F\u503C = \u8C37\u5730 = \u53D8\u6697\uFF1B0.4~1.0\uFF09
    float ao = smoothstep(-0.3, 0.3, field.x) * 0.6 + 0.4;

    // \u2605 \u76F4\u5C04\u4FDD\u5E95\uFF1A\u5899\u9762\u662F\u7AD6\u76F4\u9762\uFF0C\u6CD5\u7EBF\u6C34\u5E73\u4E0D\u53D7\u76F4\u5C04\uFF08N\xB7L\u22480\uFF09\u2014\u2014\u82E5\u6240\u5C5E\u5730\u5757
    //   \u5728\u70D8\u7119\u9634\u5F71\u533A\uFF08lm.r\u22480\uFF09\uFF0C\u6574\u9762\u5899\u53EA\u5269 ambient\xD7ao \u2248 \u7EAF\u9ED1\u3002\u76F4\u5C04\u9879\u6309
    //   \u663C\u591C\u5404\u94B3\u4E0B\u9650\uFF1A\u591C\u665A \u2265${WALL_NIGHT_DIRECT_FLOOR.toFixed(2)}\uFF08\u6708\u5149\u7EA7\uFF1B
    //   \u539F 0.85 \u6708\u5149\u5168\u5F00\u7EA7\u522B\u628A\u591C\u665A\u58C1\u9762\u9876\u5F97\u6BD4\u9876\u9762\u4EAE\u592A\u591A\u2014\u20142026-09-07 \u7528\u6237\uFF1A
    //   \u591C\u95F4\u4FA7\u58C1\u975E\u5E38\u4EAE \u2192 \u964D\u6863\uFF09\uFF0C\u767D\u5929 \u2265${WALL_DIRECT_DAY_FLOOR.toFixed(2)}
    //   \uFF08\u5761\u811A/\u5F71\u533A\u5899\u4FDD\u4EAE\uFF0C\u89C1 WALL_DIRECT_DAY_FLOOR \u8FFD\u6CE8\u91CA\uFF1B2026-09-05 \u4FEE\u5761\u9762
    //   \u4FA7\u58C1\u504F\u6697\uFF09\u3002
    //   \u2605 \u6C34\u4F53\u5899\u540C\u6837\u53D7\u4FDD\u5E95\uFF082026-09-05 \u8865\uFF09\uFF1A\u53F0\u7F18\u5761\u58C1\u4F4E\u4FA7\u82E5\u4E3A water \u5757\uFF0C\u88F8
    //   lm.r\u22480.09 \u4E58 0.32 \u589E\u76CA \u2192 \u8FD1\u4F3C\u7EAF\u9ED1\uFF08\u7528\u6237\u5B9E\u6D4B seed12345 chunk(-1,1)\uFF09\uFF1B
    //   \u4FDD\u5E95\u540E\u7ECF \xD70.32 \u4ECD\u8BFB\u4F5C\u6DF1\u6697\u6C34\u9762\uFF0C\u4E0D\u518D\u6B7B\u9ED1\u3002
    float d = mix(max(lm.r, ${WALL_NIGHT_DIRECT_FLOOR.toFixed(2)}), max(lm.r, ${WALL_DIRECT_DAY_FLOOR.toFixed(2)}), uSunDay);

    // \u2605 LOD \u5185\u5B9E\u65F6\u592A\u9633\u65B9\u5411\u91CD\u6620\u5C04\uFF08\u4E0E\u9876\u9762\u540C\u6B3E\uFF0C2026-09-05\uFF09\uFF1A\u5899\u9762\u6CD5\u7EBF\u6C34\u5E73 \u2192
    //   \u65B9\u5411\u611F\u6700\u660E\u663E\uFF08\u671D\u9633\u5899/\u80CC\u9633\u5899\u968F\u5B9E\u65F6\u592A\u9633\u5168\u5929\u65CB\u8F6C\uFF09\uFF1B\u6C34\u5899\u8C41\u514D\uFF08\u6DF1\u6697\u6C34\u9762
    //   \u662F\u4E13\u8C03\u89C2\u611F\uFF0C\u4E0D\u968F\u65B9\u5411\u53D8\u4EAE\uFF09
    {
      vec3 Lw = normalize(uSunDir);
      float dirMod = clamp(max(dot(vNw, Lw), 0.12) / max(Lw.y, 0.12),
        ${SUN_DIR_MOD_MIN.toFixed(2)}, ${SUN_DIR_MOD_MAX.toFixed(2)});
      float lodW = smoothstep(${SUN_DIR_LOD_FAR.toFixed(1)}, ${SUN_DIR_LOD_NEAR.toFixed(1)},
        length(cameraPosition - vWpos));
      d *= mix(1.0, dirMod, isWaterWall ? 0.0 : lodW);
    }

    // \u2605 \u589E\u76CA\uFF1A\u975E\u6C34\u5899 1.0\uFF08\u5149\u7167\u5DF2\u4E0E\u9876\u9762\u540C\u6E90\uFF0C\u4E0D\u518D\u9700\u8981\u8865\u507F\u5899\u811A\u584C\u7F29\uFF09\uFF1B
    //   \u6C34\u4F53\u4FA7\u58C1\u538B\u5230 32%\uFF08\u65E0\u589E\u4EAE\uFF0C\u7EAF\u70D8\u7119\u660E\u6697\uFF1B\u4E13\u8C03\u6DF1\u6697\u6C34\u9762\uFF09
    float wallGain = isWaterWall ? ${WALL_BRIGHTNESS.toFixed(2)} * 0.32 : 1.0;
    vec3 lit = base * alb * (uAmbientColor * lm.g * ao + uSunColor * d) * wallGain;

    // \u2605 \u4FA7\u58C1\u81EA\u53D1\u5149\u4FDD\u5E95\uFF08LOD \u53D1\u5149\u601D\u8DEF\uFF09\uFF1A\u7AD6\u76F4\u9762\u6CD5\u7EBF\u4E0D\u53D7\u4E0A\u65B9\u5149\u7167\uFF08N\xB7L\u22480\uFF09\uFF0C
    //   \u5149\u7167\u516C\u5F0F\u5BF9\u5899\u5929\u7136\u504F\u6697 \u2192 \u6750\u8D28\u672C\u8272\u76F4\u63A5\u53D1\u5149\uFF0C\u4E0D\u53D7 AO/\u76F4\u5C04\u906E\u6321\u5F71\u54CD
    //   \uFF08\u6C34\u4F53\u4FA7\u58C1\u4E0D\u53C2\u4E0E\u2014\u2014\u89C1 isWaterWall \u72EC\u7ACB\u8DEF\u5F84\uFF09
    if (!isWaterWall) lit += base * alb * uWallEmissive;

    gl_FragColor = vec4(lit, 1.0);
    #include <tonemapping_fragment>   // \u2605 \u4E0E\u5168\u5C40 ACES \u7BA1\u7EBF\u5BF9\u9F50\uFF08\u9876\u9762\u540C\u6B3E\uFF09
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`
);

// src/services/map/TerrainPalette.ts
function hsl2rgb(h, s, l) {
  h = (h % 1 + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255)
  ];
}

// src/services/map/Tiles.ts
var TileDef = class {
  constructor(id, key, label, genRole, visual, physics, groups = []) {
    this.id = id;
    this.key = key;
    this.label = label;
    this.genRole = genRole;
    this.visual = visual;
    this.physics = physics;
    this.groups = groups;
  }
  get isDepression() {
    return this.visual.depression;
  }
  /** 基准色 RGB（显示空间；小地图等直接消费） */
  get baseRgb() {
    return hsl2rgb(
      this.visual.baseHsl.h,
      this.visual.baseHsl.s,
      this.visual.baseHsl.l
    );
  }
};
var TILE_FLAT = new TileDef(
  0,
  "flat",
  "\u5E73\u5730/\u8DEF",
  "ground",
  {
    baseHsl: { h: 0.0881, s: 0.343, l: 0.4 },
    // ★ 明日方舟 1-7 地面 rgb(137,104,67)
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: false,
    // ★ 1-7 写实风：无 4×4 黑框（去方块拼贴感）
    material: {
      fnId: "dirt",
      // ★ 1-7 写实风：纯色为主——斑块/石子/扫痕弱化，保留高频颗粒的粗糙感
      params: { grain: 0.045, pebbles: 0.05, ruts: 0.04, patch: 0.07 }
    }
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["foundation"]
);
var TILE_PLATFORM = new TileDef(
  1,
  "platform",
  "\u9AD8\u53F0",
  "platform",
  {
    baseHsl: { h: 0.0774, s: 0.356, l: 0.537 },
    // ★ 明日方舟 1-7 高台 rgb(179,134,95)
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: false,
    // ★ 1-7 写实风：无 4×4 黑框（去方块拼贴感）
    streaks: true,
    // 拉丝金属
    material: {
      fnId: "rock",
      // ★ 1-7 写实风：纯色为主——岩理/拉丝/裂纹弱化，保留微凹凸颗粒的粗糙感
      params: { strata: 0.06, streak: 0.05, cracks: 0.05, bump: 0.12 }
    }
  },
  {
    height: 1.8,
    heightJitterRange: 0.4,
    walkable: true
  },
  ["foundation"]
);
var TILE_PIT = new TileDef(
  2,
  "pit",
  "\u5751\u6D1E",
  "pit",
  {
    baseHsl: { h: 0.98, s: 0.3, l: 0.34 },
    // 暗红警示（2026-09-05 抬 l：0.22 基色深度影下乘光仍黑到无法辨认，坡面侧壁全黑）
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: true,
    patches: true,
    patchHalf: true,
    // 警示色保持醒目
    borderLine: true,
    material: { fnId: "pit" }
    // ★ 坑洞材质（径向渐深 + 裂纹红光）
  },
  {
    height: -3,
    walkable: false,
    lethal: true
  },
  ["foundation"]
);
var TILE_WATER = new TileDef(
  4,
  "water",
  "\u6C34\u57DF",
  "liquid",
  {
    baseHsl: { h: 0.12, s: 0.06, l: 0.42 },
    // 河床基调（2026-09-07：中性灰褐沙砾，多彩卵石色由 pebble 材质逐石调制）
    jitter: { h: 3e-3, s: 0.012, l: 0.022 },
    // 河床逐地块轻微色偏（鹅卵石底，非液态均质）
    depression: true,
    patches: false,
    // 河床无色阶斑块（自有鹅卵石纹理）
    borderLine: false,
    // 水底无内描边
    material: { fnId: "pebble" }
    // ★ 水底鹅卵石河床（2026-09-07：水体模块未开工，临时静态占位；开工后换回真实水面）
  },
  {
    height: -0.5,
    walkable: false,
    smoothDirs: [0, 1, 2, 3]
    // 水全向插值
  },
  ["foundation"]
);
var TILE_SLOPE = new TileDef(
  3,
  "slope",
  "\u5761\u9053\uFF08\u9884\u7559\uFF09",
  "ground",
  {
    baseHsl: TILE_FLAT.visual.baseHsl,
    jitter: TILE_FLAT.visual.jitter,
    depression: false
  },
  { height: 0, walkable: true }
);
var TILE_ICE = new TileDef(
  10,
  "ice",
  "\u51B0\u9762",
  "ground",
  {
    baseHsl: { h: 0.55, s: 0.3, l: 0.72 },
    jitter: { h: 6e-3, s: 0.02, l: 0.04 },
    depression: false,
    borderLine: true,
    material: { fnId: "ice" }
    // ★ 冰面材质（结晶裂纹 + 闪晶 + 高镜面）
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["crystal"]
);
var TILE_ASH_FIELD = new TileDef(
  11,
  "ash_field",
  "\u7070\u70EC\u5730",
  "ground",
  {
    baseHsl: { h: 0.05, s: 0.06, l: 0.4 },
    // 灰烬地（2026-09-05 抬 l：0.32 深影下坡面读作黑）
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: "ash" }
    // ★ 灰烬材质（风积纹 + 余烬呼吸闪烁）
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["ashen"]
);
var TILE_MUD = new TileDef(
  12,
  "mud",
  "\u6CE5\u6CBC\u5730",
  "ground",
  {
    baseHsl: { h: 0.08, s: 0.15, l: 0.36 },
    // 暗灰棕（2026-09-05 抬 l：0.26 深影坡面黑）
    jitter: { h: 6e-3, s: 0.03, l: 0.04 },
    depression: false,
    borderLine: true,
    material: { fnId: "mud" }
    // ★ 泥沼材质（水洼 + 干裂纹 + 湿面高光）
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["ashen", "overgrown"]
);
var TILE_ROCK_PLATFORM = new TileDef(
  13,
  "rock_platform",
  "\u5CA9\u53F0",
  "platform",
  {
    baseHsl: { h: 0.08, s: 0.12, l: 0.42 },
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,
    material: { fnId: "rock", params: { strata: 0.06, streak: 0.06, cracks: 0.08 } }
    // ★ 岩台（2026-09-07 收敛：原 strata 0.24/streak 0.12/cracks 0.14 的水平阴影条纹带过重，对齐被保留的基础岩台舒适度）
  },
  {
    height: 1.8,
    heightJitterRange: 0.4,
    walkable: true
  },
  ["ashen"]
);
var TILE_ICE_PLATFORM = new TileDef(
  14,
  "ice_platform",
  "\u51B0\u53F0",
  "platform",
  {
    baseHsl: { h: 0.55, s: 0.22, l: 0.66 },
    jitter: { h: 6e-3, s: 0.02, l: 0.04 },
    depression: false,
    borderLine: true,
    streaks: true,
    material: { fnId: "ice", params: { crack: 0.6, frost: 0.2 } }
    // ★ 冰台（裂纹更密、霜更少）
  },
  { height: 1.8, heightJitterRange: 0.4, walkable: true },
  ["crystal"]
);
var TILE_MOSSY_PLATFORM = new TileDef(
  15,
  "mossy_platform",
  "\u82D4\u53F0",
  "platform",
  {
    baseHsl: { h: 0.3, s: 0.35, l: 0.4 },
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    streaks: true,
    material: { fnId: "moss" }
    // ★ 苔藓材质
  },
  {
    height: 1.8,
    heightJitterRange: 0.4,
    walkable: true
  },
  ["overgrown"]
);
var TILE_BRICK = new TileDef(
  16,
  "brick",
  "\u7816\u77F3\u8DEF",
  "ground",
  {
    baseHsl: { h: 0.08, s: 0.18, l: 0.42 },
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: "brick" }
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["ashen"]
);
var TILE_GRASS = new TileDef(
  17,
  "grass",
  "\u8349\u5730",
  "ground",
  {
    baseHsl: { h: 0.3, s: 0.32, l: 0.38 },
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: "grass" }
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["overgrown"]
);
var TILE_WOOD = new TileDef(
  18,
  "wood",
  "\u6728\u677F\u8DEF",
  "ground",
  {
    baseHsl: { h: 0.07, s: 0.35, l: 0.38 },
    jitter: { h: 8e-3, s: 0.03, l: 0.05 },
    depression: false,
    borderLine: true,
    material: { fnId: "wood" }
  },
  {
    height: 0,
    heightJitterBase: -0.04,
    heightJitterRange: 0.16,
    flattenAtPorts: true,
    walkable: true
  },
  ["overgrown"]
);
var TILE_FLAT_SAND = new TileDef(
  19,
  "flat_sand",
  "\u6C99\u571F\u5730\u9762",
  "ground",
  {
    baseHsl: { h: 0.0881, s: 0.343, l: 0.4 },
    // rgb(137,104,67)
    jitter: { h: 3e-3, s: 0.012, l: 0.022 },
    // ★ 逐地块轻微 HSL 色偏（4m 地块粒度）
    depression: false,
    borderLine: true,
    // ★ 地块交界黑线（0.85 强度；强化逐地块色差层次）
    material: {
      fnId: "sand",
      // ★ 条带装饰 = 沙土地块专属（斑马线式琥珀虚线段，20% 地块出现；shader slot15 门控）
      params: { stripes: 0.55, hazard: 0.85 }
      // ★ 警示贴画 = 沙土地块专属（黑黄 45° 警示方框贴画，~20% 地块出现；shader slot14 门控）
    }
    // 沙土材质（细沙粒 + 微起伏）+ 条带装饰 + 警示贴画
  },
  TILE_FLAT.physics,
  ["foundation"]
);
var TILE_PLATFORM_SAND = new TileDef(
  20,
  "platform_sand",
  "\u6C99\u571F\u9AD8\u53F0",
  "platform",
  {
    baseHsl: { h: 0.0774, s: 0.356, l: 0.537 },
    // rgb(179,134,95)
    jitter: { h: 3e-3, s: 0.012, l: 0.022 },
    // ★ 逐地块轻微 HSL 色偏（4m 地块粒度）
    depression: false,
    borderLine: true,
    // ★ 地块交界黑线（0.85 强度；强化逐地块色差层次）
    material: { fnId: "sand" }
    // 沙土材质（与地面同质感）
  },
  TILE_PLATFORM.physics,
  ["foundation"]
);
var TILE_CEMENT_PLATFORM = new TileDef(
  21,
  "cement_platform",
  "\u6C34\u6CE5\u9AD8\u53F0",
  "platform",
  {
    // 背景色（2026-09-06）：水泥灰，当前再增亮 13%（用户定版）
    // 原 0x6f6f6a → sRGB(111,111,106) → HSL(h≈0.1667, s≈0.023, l≈0.4255)
    // 减半 → l 0.21 → 增亮 13% → l ≈ 0.237
    baseHsl: { h: 0.1667, s: 0.023, l: 0.237 },
    jitter: { h: 3e-3, s: 0.012, l: 0.022 },
    // ★ 逐地块轻微 HSL 色偏（4m 地块粒度）
    depression: false,
    borderLine: true,
    // ★ 地块交界黑线（0.85 强度；强化逐地块色差层次）
    material: { fnId: "cement" }
    // ★ 水泥材质（平滑灰面 + 少噪点）
  },
  TILE_PLATFORM.physics,
  ["foundation"]
);
var REGISTRY2 = /* @__PURE__ */ new Map();
var KEY_INDEX = /* @__PURE__ */ new Map();
for (const t of [
  TILE_FLAT,
  TILE_PLATFORM,
  TILE_PIT,
  TILE_SLOPE,
  TILE_WATER,
  TILE_ICE,
  TILE_ASH_FIELD,
  TILE_MUD,
  TILE_ROCK_PLATFORM,
  TILE_ICE_PLATFORM,
  TILE_MOSSY_PLATFORM,
  TILE_BRICK,
  TILE_GRASS,
  TILE_WOOD,
  TILE_FLAT_SAND,
  TILE_PLATFORM_SAND,
  TILE_CEMENT_PLATFORM
]) {
  if (REGISTRY2.has(t.id)) throw new Error(`[Tiles] \u5730\u5757 id \u51B2\u7A81: ${t.id}`);
  REGISTRY2.set(t.id, t);
  KEY_INDEX.set(t.key, t);
}

// src/services/map/TileGroups.ts
var REGISTRY3 = /* @__PURE__ */ new Map();
function registerGroup(def) {
  if (REGISTRY3.has(def.key)) throw new Error(`[TileGroups] \u7EC4 key \u5DF2\u5B58\u5728: ${def.key}`);
  REGISTRY3.set(def.key, def);
}
var NEUTRAL_PALETTE = { hueShift: 0, satMul: 1, lightMul: 1 };
var NEUTRAL_GEN = { densityBias: 0, waterMul: 1, pitMul: 1 };
registerGroup({
  key: "foundation",
  label: "\u57FA\u77F3",
  // ★ 2026-09-05 转正：用户定调"1-7 沙土风才是精心制作的主力内容"——
  //   基石组参与正式选组（权重 1，与主题组均等，中性调色保持原味）；
  //   兼职不变：生效组缺角色时仍走本组回退。
  weight: 1,
  members: { flat_sand: 1, platform_sand: 1, cement_platform: 0.2, water: 1, pit: 1 },
  palette: NEUTRAL_PALETTE,
  gen: NEUTRAL_GEN
});
registerGroup({
  key: "crystal",
  label: "\u971C\u84DD\u7ED3\u6676",
  weight: 1,
  members: { ice: 3, ice_platform: 3, water: 1, pit: 1 },
  palette: { hueShift: 0.47, satMul: 0.85, lightMul: 1.02 },
  gen: { densityBias: 0.1, waterMul: 1.7, pitMul: 0.6 }
});
registerGroup({
  key: "ashen",
  label: "\u7070\u70EC\u5E9F\u571F",
  weight: 1,
  members: { ash_field: 3, mud: 1, rock_platform: 3, pit: 2, water: 0.5, brick: 2 },
  palette: { hueShift: 0, satMul: 0.45, lightMul: 0.82 },
  gen: { densityBias: -0.06, waterMul: 0.6, pitMul: 1.2 }
});
registerGroup({
  key: "overgrown",
  label: "\u6C83\u7EFF\u8513\u751F",
  weight: 1,
  members: { mud: 2, mossy_platform: 3, water: 2, pit: 0.5, grass: 2, wood: 2 },
  palette: { hueShift: 0.33, satMul: 1.05, lightMul: 0.98 },
  gen: { densityBias: 0, waterMul: 1.4, pitMul: 0.7 }
});

// src/services/map/ChunkGenerator.ts
var CHUNK_SIZE = 60;
var BLOCK_SIZE = 4;
var BLOCKS_PER_SIDE = CHUNK_SIZE / BLOCK_SIZE;

// src/services/map/Refinements.ts
var WELD_RAMP_CELLS = BLOCK_SIZE / 3;

// src/services/map/WaterSurface.ts
var HALF = CHUNK_SIZE / 2;
var WATER_MAX_DEEP = 6;
var LIP_STRIDE = 0.05;
var BED_GRID = Math.round(4 / LIP_STRIDE);

// src/services/map/WaterFFT.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeGauss(rng) {
  const base = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
  return base;
}
function complexFFT(re, im, N, sign) {
  for (let i = 0, j = 0; i < N - 1; i++) {
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
    let m = N >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = sign * (2 * Math.PI / len);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k + half], ai = im[i + k + half];
        const tr = cr * ar - ci * ai;
        const ti = cr * ai + ci * ar;
        re[i + k + half] = re[i + k] - tr;
        im[i + k + half] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}
var OCEAN_WIND = { x: 0.35, z: 0.94 };
var DEFAULT_OCEAN_LAYERS = [
  { tileSize: 16, N: 64, amp: 0.1, chop: 0.09 },
  // L0 涌浪：水池内半个波长
  { tileSize: 6, N: 128, amp: 0.05, chop: 0.12 },
  // L1 主波
  { tileSize: 1.5, N: 128, amp: 0.015, chop: 0.1 }
  // L2 细节（片元为主）
];
function defaultOceanParams(seed) {
  return {
    seed,
    windX: OCEAN_WIND.x,
    windZ: OCEAN_WIND.z,
    windSpeed: 9,
    layers: DEFAULT_OCEAN_LAYERS,
    variants: 2
  };
}
function bakeLayer(N, tileSize, windX, windZ, L, seed, amp, chop) {
  const invG = 1 / 9.81;
  const wLen = Math.hypot(windX, windZ) || 1;
  const wx = windX / wLen, wz = windZ / wLen;
  const n2 = N * N;
  const SpR = new Float32Array(n2);
  const SpI = new Float32Array(n2);
  const gauss = makeGauss(mulberry32(seed & 4294967295));
  const k0 = 2 * Math.PI / tileSize;
  const filled = new Uint8Array(n2);
  for (let fx = 0; fx < N; fx++) {
    const kx = (fx < N / 2 ? fx : fx - N) * k0;
    for (let fy = 0; fy < N; fy++) {
      const idx = fy * N + fx;
      if (filled[idx]) continue;
      const ky = (fy < N / 2 ? fy : fy - N) * k0;
      const k = Math.hypot(kx, ky);
      let A = 0;
      if (k > 1e-6) {
        const kL = k * L;
        const dir = wx * (kx / k) + wz * (ky / k);
        const d22 = Math.max(dir, 0);
        A = Math.sqrt(Math.exp(-1 / (kL * kL)) / (k * k * k * k) * d22 * d22);
      }
      SpR[idx] = A * gauss();
      SpI[idx] = A * gauss();
      filled[idx] = 1;
      const mx = (N - fx) % N, my = (N - fy) % N;
      const mid = my * N + mx;
      if (mid !== idx) {
        SpR[mid] = SpR[idx];
        SpI[mid] = -SpI[idx];
        filled[mid] = 1;
      }
    }
  }
  const scale = 1 / (N * N);
  const ifftInt = (srcR, srcI) => {
    const r = new Float32Array(srcR);
    const c = new Float32Array(srcI);
    for (let fy = 0; fy < N; fy++) {
      complexFFT(r.subarray(fy * N, fy * N + N), c.subarray(fy * N, fy * N + N), N, -1);
    }
    const cr = new Float32Array(N * N), ci = new Float32Array(N * N);
    for (let fy = 0; fy < N; fy++) {
      for (let fx = 0; fx < N; fx++) {
        cr[fy * N + fx] = r[fx * N + fy];
        ci[fy * N + fx] = c[fx * N + fy];
      }
    }
    for (let fx = 0; fx < N; fx++) {
      const segR = cr.subarray(fx * N, fx * N + N);
      const segI = ci.subarray(fx * N, fx * N + N);
      complexFFT(segR, segI, N, -1);
      for (let fy = 0; fy < N; fy++) cr[fy * N + fx] = segR[fy] * scale;
    }
    return cr;
  };
  const hRaw = ifftInt(SpR, SpI);
  const dxR = new Float32Array(n2), dxI = new Float32Array(n2);
  const dzR = new Float32Array(n2), dzI = new Float32Array(n2);
  for (let fx = 0; fx < N; fx++) {
    const kx = (fx < N / 2 ? fx : fx - N) * k0;
    for (let fy = 0; fy < N; fy++) {
      const idx = fy * N + fx;
      const ky = (fy < N / 2 ? fy : fy - N) * k0;
      const k = Math.hypot(kx, ky);
      if (k > 1e-6) {
        const s = SpI[idx], c_ = SpR[idx];
        dxR[idx] = kx / k * s;
        dxI[idx] = -(kx / k) * c_;
        dzR[idx] = ky / k * s;
        dzI[idx] = -(ky / k) * c_;
      }
    }
  }
  const d1 = ifftInt(dxR, dxI);
  const d2 = ifftInt(dzR, dzI);
  const rmsH = (() => {
    let s = 0;
    for (let i = 0; i < n2; i++) s += hRaw[i] * hRaw[i];
    return Math.sqrt(s / n2 + 1e-12);
  })();
  const h = new Float32Array(n2);
  const hGain = amp / rmsH;
  for (let i = 0; i < n2; i++) h[i] = hRaw[i] * hGain;
  const dArr = new Float32Array(n2 * 2);
  {
    let s = 0;
    for (let i = 0; i < n2; i++) s += d1[i] * d1[i] + d2[i] * d2[i];
    const rmsD = Math.sqrt(s / (n2 * 2) + 1e-12);
    const dGain = chop * (tileSize / N) * 4 / rmsD;
    for (let i = 0; i < n2; i++) {
      dArr[i] = d1[i] * dGain;
      dArr[n2 + i] = d2[i] * dGain;
    }
  }
  const dx = tileSize / N;
  const n = new Float32Array(n2 * 3);
  const slopeK = 1 / dx;
  for (let y = 0; y < N; y++) {
    const ym = (y - 1 + N) % N, yp = (y + 1) % N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N, xp = (x + 1) % N;
      const sx = (h[y * N + xp] - h[y * N + xm]) * slopeK * 0.5;
      const sz = (h[yp * N + x] - h[ym * N + x]) * slopeK * 0.5;
      const inv = 1 / Math.sqrt(sx * sx + sz * sz + 1);
      n[(y * N + x) * 3] = -sx * inv;
      n[(y * N + x) * 3 + 1] = inv;
      n[(y * N + x) * 3 + 2] = -sz * inv;
    }
  }
  return { h, d: dArr, n };
}
function bakeOceanField(p) {
  const L = p.windSpeed * p.windSpeed / 9.81;
  const tiles = [];
  for (const lc of p.layers) {
    const vs = [];
    for (let v = 0; v < p.variants; v++) {
      const seed = (p.seed ^ 2654435769) + v * 2654435761 + lc.N * 31;
      vs.push(bakeLayer(lc.N, lc.tileSize, p.windX, p.windZ, L, seed >>> 0, lc.amp, lc.chop));
    }
    tiles.push(vs);
  }
  return tiles;
}

// src/services/map/WaterMaterial.ts
var OCEAN_SEED = 12345;
function halfFloatTexture(data, w, h, format) {
  const raw = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) raw[i] = THREE2.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE2.DataTexture(raw, w, h, format, THREE2.HalfFloatType);
  tex.wrapS = THREE2.RepeatWrapping;
  tex.wrapT = THREE2.RepeatWrapping;
  tex.magFilter = THREE2.LinearFilter;
  tex.minFilter = THREE2.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE2.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
function bakeOceanTextures(params) {
  const tiles = bakeOceanField(params);
  const hdA = [], hdB = [];
  const nA = [], nB = [];
  for (const layer of tiles) {
    const [tileA, tileB] = layer;
    const N = Math.sqrt(tileA.h.length) | 0;
    hdA.push(packHD(tileA, N));
    hdB.push(packHD(tileB, N));
    nA.push(packN(tileA, N));
    nB.push(packN(tileB, N));
  }
  return { hdA, hdB, nA, nB };
  function packHD(t, N) {
    const f = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      f[i * 4] = t.h[i];
      f[i * 4 + 1] = t.d[i];
      f[i * 4 + 2] = t.d[N * N + i];
    }
    return halfFloatTexture(f, N, N, THREE2.RGBAFormat);
  }
  function packN(t, N) {
    const f = new Float32Array(N * N * 3);
    f.set(t.n, 0);
    return halfFloatTexture(f, N, N, THREE2.RGBFormat);
  }
}
var oceanTextures = null;
function ensureOceanTextures() {
  if (!oceanTextures) {
    oceanTextures = bakeOceanTextures(defaultOceanParams(OCEAN_SEED));
  }
  return oceanTextures;
}
var WATER_VERT = (
  /* glsl */
  `
  attribute float deep;
  attribute float border;
  attribute vec2 spin;
  uniform float uTime;
  uniform float uHasOcean;
  uniform vec2 uScrollDir;
  uniform vec3 uLayerScale;   // \u6BCF\u5C42\u4E16\u754C\u5C3A\u5EA6\uFF08m\uFF09
  uniform vec3 uSpeed;        // \u6BCF\u5C42\u6EDA\u52A8\u901F\u5EA6\uFF08m/s\uFF09
  uniform vec3 uAmp;          // \u6BCF\u5C42\u9AD8\u5EA6\u5E45\u5EA6
  uniform vec3 uChop;         // \u6BCF\u5C42 choppy \u4F4D\u79FB\u5E45\u5EA6
  uniform vec3 uTriPeriod;    // \u6BCF\u5C42 A/B \u4EA4\u53E0\u5468\u671F\uFF08s\uFF09

  uniform sampler2D uHD0A; uniform sampler2D uHD0B;
  uniform sampler2D uHD1A; uniform sampler2D uHD1B;
  uniform sampler2D uHD2A; uniform sampler2D uHD2B;
  uniform float uAmpScale;
  uniform float uChopScale;  // boss4D choppy \u5355\u72EC\u7F29\u653E\uFF08\u6C34\u5E73\u4F4D\u79FB\u66F4\u654F\u611F\uFF09

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDeep;
  varying vec3 vWorld;
  #include <fog_pars_vertex>

  // \u6CE2\u6D6A\u4E09\u89D2\u4EA4\u53E0\u6743\u91CD\uFF080\u21921\u21920\uFF0C\u5FAA\u73AF\u65E0\u8272\u7F1D\uFF09
  float triW(float t, float period) {
    return 1.0 - abs(2.0 * fract(t / period * 0.5) - 1.0);
  }

  // \u65E7\u89E3\u6790\u6CE2\u52A8\uFF08\u6C34\u5E18/boss \u4ECD\u7528\uFF1B\u4FDD\u8BC1\u5751\u6C34\u4EA4\u754C\u4E0E\u5E55\u5E03\u6B63\u786E\u8DDF\u968F\uFF09
  float waterWaveY(vec2 p, float t) {
    return 0.06 * ( 0.60 * sin(p.x * 0.55 + t * 1.40)
                  + 0.55 * sin(p.y * 0.75 - t * 1.10)
                  + 0.35 * sin((p.x + p.y) * 0.35 + t * 0.80) );
  }

  // L0\uFF1A\u6D8C\u6D6A\uFF08\u4EC5\u9876\u70B9\u4F4D\u79FB\uFF09
  vec4 hdLayer0(vec2 uv, float t) {
    float w = triW(t, uTriPeriod.x);
    vec4 a = texture2D(uHD0A, uv);
    vec4 b = texture2D(uHD0B, uv);
    return mix(a, b, w);
  }
  // L1\uFF1A\u4E3B\u6CE2\uFF08\u9876\u70B9\u4F4D\u79FB\uFF09
  vec4 hdLayer1(vec2 uv, float t) {
    float w = triW(t, uTriPeriod.y);
    vec4 a = texture2D(uHD1A, uv);
    vec4 b = texture2D(uHD1B, uv);
    return mix(a, b, w);
  }

  void main() {
    vUv = uv;
    vNormal = normalize(normal);
    vDeep = deep;
    // ---- boss4D \u6C34\u5E55\uFF1A\u81EA\u8F6C\uFF08\u51E0\u4F55\u4EE5\u81EA\u8EAB\u4E2D\u5FC3\u4E3A\u539F\u70B9\uFF09----
    float isFall = step(0.5, -deep);        // deep -1\uFF08\u5751\u5E18\uFF09/ -2\uFF08boss4D \u6C34\u5E55\uFF09: 1
    float isBoss = step(0.5, -deep - 1.5);  // deep -2: 1
    // isRoof: 1 = \u4E0D\u662F\u5C4B\u9876\uFF08deep != -3\uFF09; 0 = \u662F\u5C4B\u9876\uFF08deep == -3\uFF09
    float isNotRoof = step(0.5, abs(deep + 3.0)); // abs(deep+3)\u22650.5 \u2192 1\uFF08\u975E\u5C4B\u9876\uFF09
    vec3 pos = position;
    if (isBoss > 0.5) {
      float ang = spin.x * uTime + spin.y;
      float sa = sin(ang), ca = cos(ang);
      float px = pos.x, pz = pos.z;
      pos.x = px * ca + pz * sa;
      pos.z = -px * sa + pz * ca;
    }
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorld = wp.xyz;
    float wv = 0.0;
    if (isNotRoof > 0.5 && isFall <= 0.5 && uHasOcean > 0.5 && border < 0.5) {
      // \u2605 \u6C34\u9762\uFF08deep=0\uFF09\u5185\u90E8\u9876\u70B9\uFF1A\u9884\u8BA1\u7B97 FFT \u4F4D\u79FB\uFF08\u4E16\u754C uv\uFF0C\u8DE8 chunk \u65E0\u7F1D\uFF09
      //   \u8FB9\u754C\u9876\u70B9\uFF08border=1\uFF0C\u4E0E\u5CB8/\u5751/\u6C34\u5E18\u4EA4\u754C\uFF09\u4FDD\u6301\u9759\u6B62\uFF0C\u907F\u514D\u7EB9\u7406\u6027\u7FD8\u8FB9\u3002
      vec2 uv0 = wp.xz / uLayerScale.x + uScrollDir * (uTime * uSpeed.x);
      vec2 uv1 = wp.xz / uLayerScale.y + uScrollDir * (uTime * uSpeed.y);
      vec4 a = hdLayer0(uv0, uTime);
      vec4 b = hdLayer1(uv1, uTime);
      float h = a.r * uAmp.x + b.r * uAmp.y;
      vec2 disp = a.gb * uChop.x + b.gb * uChop.y;
      wp.x += disp.x * uChopScale;
      wp.z += disp.y * uChopScale;
      wp.y += h * uAmpScale;
    } else if (isFall > 0.5) {
      wv = waterWaveY(wp.xz, uTime);
      if (isFall > 0.5) wv *= 1.0 - vUv.y * vUv.y;
      wp.y += wv;
    }
    // deep=-3 \u5C4B\u9876\uFF1A\u65E0\u4F4D\u79FB\uFF08\u4FDD\u6301\u7A33\u5B9A\uFF09
    if (isBoss > 0.5) wp.y += 0.5 * sin(uTime * 0.9 + spin.y * 3.0); // 4D \u6F02\u6D6E\u5FAE\u52A8
    vec4 mvPosition = viewMatrix * wp;
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`
);
var WATER_FRAG = (
  /* glsl */
  `
  uniform vec3 uAmbientColor;
  uniform vec3 uSunColor;
  uniform float uSunDay;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uMaxDeep;
  uniform vec2 uScrollDir;
  uniform vec3 uLayerScale;
  uniform vec3 uSpeed;
  uniform vec3 uAmp;
  uniform vec3 uLayerAmp; // \u5404\u5C42\u5DF2\u70D8\u7119 RMS \u5E45\u5EA6\uFF08\u7247\u5143\u76F8\u5BF9\u5F52\u4E00\u7528\uFF09
  uniform vec3 uTriPeriod;
  uniform vec3 uTexelCount; // \u5404\u5C42\u7EB9\u7D20\u6570\uFF08LOD/\u7C97\u7CD9\u5EA6\u7528\uFF09
  uniform float uWindSpeed; // \u98CE\u901F m/s\uFF08Cox-Munk \u7C97\u7CD9\u5EA6\u3001\u767D\u5E3D onset \u7528\uFF09

  uniform sampler2D uHD0A; uniform sampler2D uHD0B;
  uniform sampler2D uHD1A; uniform sampler2D uHD1B;
  uniform sampler2D uHD2A; uniform sampler2D uHD2B;
  uniform sampler2D uN0A; uniform sampler2D uN0B;
  uniform sampler2D uN1A; uniform sampler2D uN1B;
  uniform sampler2D uN2A; uniform sampler2D uN2B;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDeep;
  varying vec3 vWorld;

  #include <common>
  #include <fog_pars_fragment>

  float triW(float t, float period) {
    return 1.0 - abs(2.0 * fract(t / period * 0.5) - 1.0);
  }

  vec2 nl(sampler2D a, sampler2D b, vec2 uv, float w) {
    vec2 la = texture2D(a, uv).xy * 2.0 - 1.0;
    vec2 lb = texture2D(b, uv).xy * 2.0 - 1.0;
    return mix(la, lb, w);
  }
  vec3 norm(sampler2D a, sampler2D b, vec2 uv, float w) {
    vec3 na = texture2D(a, uv).xyz * 2.0 - 1.0;
    vec3 nb = texture2D(b, uv).xyz * 2.0 - 1.0;
    return normalize(mix(na, nb, w));
  }

  // ---- Cox-Munk \u5FAE\u9762\uFF08\u9879\u76EE\u540C\u6B3E\uFF09----
  float ggxD(float NoH, float a) {
    float a2 = a * a;
    return a2 / (3.14159265 * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0));
  }
  float smithGGXCorrelated(float NoV, float NoL, float a) {
    float a2 = a * a;
    float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
    float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-5);
  }

  // \u6CE1\u6CAB\u98CE\u6761\u7EB9\u566A\u58F0\uFF08hash \u2192 \u53CC\u516B\u5EA6\u503C\u566A\u58F0\uFF0C\u98CE\u65B9\u5411\u62C9\u957F\uFF09
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec3 N;
    float isFall = step(0.5, -vDeep); // deep<0\uFF1A\u6C34\u5E18(\u5751 -1)/\u5E55\u5E03(-2)/\u659C\u8FB9(-3)
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(abs(dot(normalize(vNormal), V)), 0.0, 1.0), 2.0);

    vec3 col;
    float alpha;
    if (isFall > 0.5) {
      // \u2605 \u6C34\u5E18\uFF08\u4E0E\u539F\u7BA1\u7EBF\u4E00\u81F4\uFF09\uFF1AvUv.y = 0 \u5507 \u2192 1 \u5751\u5E95
      float t = vUv.y;
      float isRoof = 1.0 - step(0.5, abs(vDeep + 3.0)); // \u4EC5 deep==-3 \u659C\u8FB9
      vec3 waterAlbedo = vec3(0.40, 0.72, 0.68);      // \u4E0E\u6C34\u9762\u9876\u540C\u8272\uFF08\u4EA4\u5408\u89C4\uFF09
      vec3 bottom = vec3(0.10, 0.22, 0.25);           // \u5751\u5E95\uFF1A\u660E\u4EAE\u4E9B\uFF0C\u907F\u514D\u5E55\u5E03\u6574\u4F53\u8FC7\u6DF1
      vec3 grad = mix(waterAlbedo, bottom, smoothstep(0.0, 0.85, t)); // \u4E0B\u6C89\u66F4\u7F13\u66F4\u4E45
      float streak = isRoof > 0.5 ? 0.80 : 0.60 + 0.40 * sin(vUv.x * 11.0 - uTime * 3.0 + t * 5.0);
      col = grad * (0.80 + 0.20 * streak);
      float foamEdge = 1.0 - smoothstep(0.0, 0.08, t); // \u5507\u6CBF\u8584\u6CE1\u6CAB
      col += vec3(foamEdge * 0.20);
      float glint = pow(max(dot(normalize(vNormal), normalize(vec3(0.0, 0.6, 1.0) - V)), 0.0), 6.0);
      col += glint * vec3(0.18, 0.28, 0.30);
      col *= uAmbientColor * 1.1 + uSunColor * 0.32 * uSunDay;
      col = mix(col, vec3(0.40, 0.72, 0.68) * (uAmbientColor * 0.95 + uSunColor * 0.10 * uSunDay), isRoof);
      alpha = mix(0.55, 0.15, isRoof);
      float jb = (1.0 - step(0.5, -vDeep - 1.5)) * (1.0 - smoothstep(0.0, 0.20, t));
      col = mix(vec3(0.40, 0.72, 0.68) * (uAmbientColor * 0.95 + uSunColor * 0.10 * uSunDay), col, jb);
    } else {
      // ---- \u2605 \u6C34\u9762\uFF1AFFT \u573A + \u53C2\u8003 natural-disasters \u6E32\u67D3\u601D\u60F3 ----
      vec2 uv0 = vWorld.xz / uLayerScale.x + uScrollDir * (uTime * uSpeed.x);
      vec2 uv1 = vWorld.xz / uLayerScale.y + uScrollDir * (uTime * uSpeed.y);
      vec2 uv2 = vWorld.xz / uLayerScale.z + uScrollDir * (uTime * uSpeed.z);

      float w0 = triW(uTime, uTriPeriod.x);
      float w1 = triW(uTime, uTriPeriod.y);
      float w2 = triW(uTime, uTriPeriod.z);

      // \u50CF\u7D20\u8DB3\u5370\uFF08\u7C73\uFF09\uFF1A\u51B3\u5B9A\u54EA\u4E9B\u7EC6\u8282\u8FDB mss \u7C97\u7CD9\u5EA6\u3001\u54EA\u4E9B\u8FD8\u80FD\u89E3\u6790
      vec2 dq = dFdx(vWorld.xz);
      vec2 dqv = dFdy(vWorld.xz);
      float fpA = length(dq), fpB = length(dqv);
      float fpShade = sqrt(max(fpA * fpB, 1e-5));   // \u5404\u5411\u540C\u6027\u7B49\u6548\u8DB3\u5370

      // --- \u6CD5\u7EBF\uFF1A\u591A\u5C3A\u5EA6\u659C\u7387\u53E0\u52A0\uFF08\u51E0\u4F55\u6CD5\u7EBF\u5305\u5E95\uFF0C\u4FDD\u6301"\u9762"\u7684\u8FDE\u7EED\u6027\uFF09---
      vec3 n0 = norm(uN0A, uN0B, uv0, w0);   // L0 \u6D8C\u6D6A\uFF1A\u5927\u5C3A\u5EA6\u659C\u7387
      vec3 n1 = norm(uN1A, uN1B, uv1, w1);   // L1 \u4E3B\u6CE2
      vec3 n2 = norm(uN2A, uN2B, uv2, w2);   // L2 \u7EC6\u8282
      vec3 N3 = n0 + n1 + n2;
      // footprint \u8D8A\u5927 \u2192 \u4FDD\u7559\u51E0\u4F55\u6CD5\u7EBF\u8D8A\u591A\uFF08\u8FDC\u5904\u4E0D\u6296\u3001\u4E0D\u82B1\uFF09
      float geoW = clamp(fpShade * 0.5, 0.0, 1.0);
      N = normalize(mix(N3, vNormal, geoW * 0.7));

      // --- \u7C97\u7CD9\u5EA6\uFF08Cox-Munk\uFF09\uFF1A\u6BCF\u4E2A cascade \u4E22\u5931\u7684\u7EC6\u8282 \u2192 mss ---
      vec3 texel = uLayerScale / uTexelCount;
      vec3 lod = log2(max(vec3(fpShade) / texel, vec3(1.0)));
      float mssTotal = 0.003 + 0.00512 * max(uWindSpeed, 0.5);
      vec3 share = vec3(0.06, 0.30, 0.64);
      float lost = share.x * clamp(lod.x / 6.0, 0.0, 1.0)
                 + share.y * clamp(lod.y / 6.0, 0.0, 1.0)
                 + share.z * clamp(lod.z / 6.0, 0.0, 1.0);
      float mssUnres = mssTotal * lost + 0.0009;
      float mssA = clamp(sqrt(2.0 * mssUnres), 0.012, 0.62);
      float roughness = clamp(sqrt(mssA), 0.02, 0.86);

      // \u9AD8\u5EA6\uFF08\u6CE1\u6CAB/\u900F\u4EAE\u7528\uFF09\u201C\u76F8\u5BF9\u81EA\u8EAB RMS \u5F52\u4E00\u201D
      float h1x = mix(texture2D(uHD1A, uv1).r, texture2D(uHD1B, uv1).r, w1);
      float h2x = mix(texture2D(uHD2A, uv2).r, texture2D(uHD2B, uv2).r, w2);
      float h1n = h1x / max(uLayerAmp.y, 1e-4);
      float h2n = h2x / max(uLayerAmp.z, 1e-4);

      vec3 L = normalize(uSunDir);
      float NoV = max(dot(N, V), 1e-4);
      float F = 0.03 + 0.97 * pow(1.0 - NoV, 5.0); // Schlick \u83F2\u6D85\u5C14

      // \u6DF1\u5EA6\u6C34\u8272
      float depthT = clamp(vDeep / uMaxDeep, 0.0, 1.0);
      vec3 shallow = vec3(0.36, 0.66, 0.62);
      vec3 deepc = vec3(0.04, 0.13, 0.17);
      vec3 body = mix(shallow, deepc, depthT);

      // \u7126\u6563\uFF08\u6298\u5C04\u5149\u6C47\u805A\uFF09
      float cau = pow(max(dot(n2, L), 0.0), 4.0);
      vec3 refracted = body * (uAmbientColor * 0.95 + uSunColor * (0.08 + cau * 0.10) * uSunDay);

      // --- \u80CC\u5149\u900F\u5C04\uFF08\u53C2\u8003\u9879\u76EE\uFF09\uFF1A\u6CE2\u5CF0\u8584\u6C34\u9006\u5149\u53D1\u5149 ---
      float waveH = clamp(h1n * 0.25 + h2n * 0.55, 0.0, 1.6);
      float backlit = pow(clamp(dot(L, -V), 0.0, 1.0), 4.0)
                    * pow(0.5 - 0.5 * dot(N, L), 3.0);
      refracted += vec3(0.10, 0.55, 0.45) * uSunColor * backlit * waveH * 0.9 * uSunDay;

      // --- \u6CE1\u6CAB\uFF08\u53C2\u8003\u9879\u76EE\uFF09\uFF1A\u98CE\u6761\u7EB9\u566A\u58F0\u96D5\u523B + \u6CE2\u5CF0\u767D\u6CAB ---
      float shore = 1.0 - smoothstep(0.0, 0.5, vDeep);          // \u5CB8\u6D45
      float waveFoam = smoothstep(1.2, 2.6, h1n) * smoothstep(1.0, 2.2, h2n);
      float foamMask = (waveFoam * uSunDay) * 0.85 + shore * 0.6;
      vec2 wind = uScrollDir;
      vec2 qs = mat2(wind.x, -wind.y, wind.y, wind.x) * vWorld.xz * 0.12;
      float windy = vnoise(qs + vec2(0.0, -uTime * 0.9)) * 0.45
                  + vnoise(qs * vec2(4.0, 4.0) * 3.0 + vec2(uTime * 1.3, 0.0)) * 0.35;
      float onset = mix(0.55, 0.3, clamp(uWindSpeed / 8.0, 0.0, 1.0));
      float carved = foamMask * (0.10 + windy * 1.4);
      float foam = smoothstep(onset, onset + 0.25, carved);
      foam *= 0.5 + 0.5 * smoothstep(0.35, 2.2, fpShade);       // \u8FD1\u5904\u6CE1\u6CAB\u53EF\u89C1
      refracted = mix(refracted, vec3(0.93, 0.96, 0.985) * (uAmbientColor * 0.95 + uSunColor * 0.30 * uSunDay), foam * 0.6);

      // --- \u7A0B\u5E8F\u5316\u5929\u7A7A\u53CD\u6F14\uFF08\u542B\u592A\u9633\u76D8\uFF1B\u7C97\u7565\u5EA6\u8D8A\u5927\u53CD\u5C04\u8D8A\u7CCA\uFF09---
      vec3 Rf = reflect(-V, N);
      float ry = clamp(Rf.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 zenith = vec3(0.05, 0.10, 0.18);
      vec3 horiz = vec3(0.52, 0.66, 0.72);
      float blurR = mix(pow(ry, 0.55), smoothstep(0.0, 1.0, ry), clamp(roughness, 0.0, 1.0));
      vec3 sky = mix(horiz, zenith, blurR);
      vec3 sunDisk = uSunColor * max(pow(max(dot(Rf, L), 0.0), 400.0) * 1.2, 0.0) * uSunDay;
      sky = sky * (uAmbientColor * 1.05 + uSunColor * 0.28 * uSunDay) + sunDisk * 0.30;

      float reflMix = F * (0.35 + 0.65 * depthT);
      vec3 color = mix(refracted, sky, reflMix);

      // --- \u592A\u9633\u9AD8\u5149\uFF1AGGX \u5FAE\u9762\uFF08Cox-Munk \u03B1\uFF09+ \u9AD8\u529F\u7387\u53CD\u5C16 ---
      vec3 H = normalize(L + V);
      float NoH = max(dot(N, H), 0.0);
      float VoH = max(dot(V, H), 1e-4);
      float NoL = max(dot(N, L), 1e-4);
      float D = ggxD(NoH, mssA);
      float Vis = smithGGXCorrelated(NoV, NoL, mssA);
      float Fs = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
      color += uSunColor * D * Vis * Fs * NoL * 5.0 * uSunDay;

      // \u5CB8\u7EBF\u6DE1\u8272\u900F\u5E95
      color = mix(color, color * 1.12 + vec3(0.04, 0.10, 0.08), shore * 0.5);

      col = color;
      alpha = clamp(mix(0.5, 0.85, depthT) + foam * 0.22, 0.0, 0.96);
      N = normalize(vNormal);
    }

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`
);
var WaterMaterial = class extends THREE2.ShaderMaterial {
  constructor() {
    const tex = ensureOceanTextures();
    super({
      uniforms: Object.assign(THREE2.UniformsUtils.clone(THREE2.UniformsLib.fog), {
        uAmbientColor: { value: new THREE2.Color(10135748).multiplyScalar(0.65) },
        uSunColor: { value: new THREE2.Color(16774112).multiplyScalar(1.1) },
        uSunDay: { value: 1 },
        uSunDir: { value: new THREE2.Vector3(-0.342, 1, 0.94).normalize() },
        uTime: { value: 0 },
        uMaxDeep: { value: WATER_MAX_DEEP },
        // ---- FFT 海况场 ----
        uHasOcean: { value: 1 },
        uScrollDir: { value: new THREE2.Vector2(0.35, 0.94).normalize() },
        uLayerScale: { value: new THREE2.Vector3(16, 6, 1.5) },
        uSpeed: { value: new THREE2.Vector3(0.14, 0.28, 0.5) },
        uAmp: { value: new THREE2.Vector3(1, 1, 1) },
        uLayerAmp: { value: new THREE2.Vector3(DEFAULT_OCEAN_LAYERS[0].amp, DEFAULT_OCEAN_LAYERS[1].amp, DEFAULT_OCEAN_LAYERS[2].amp) },
        uChop: { value: new THREE2.Vector3(1, 1, 1) },
        uTriPeriod: { value: new THREE2.Vector3(11, 8, 5) },
        uTexelCount: { value: new THREE2.Vector3(64, 128, 128) },
        uWindSpeed: { value: 2.5 },
        uHD0A: { value: tex.hdA[0] },
        uHD0B: { value: tex.hdB[0] },
        uHD1A: { value: tex.hdA[1] },
        uHD1B: { value: tex.hdB[1] },
        uHD2A: { value: tex.hdA[2] },
        uHD2B: { value: tex.hdB[2] },
        uN0A: { value: tex.nA[0] },
        uN0B: { value: tex.nB[0] },
        uN1A: { value: tex.nA[1] },
        uN1B: { value: tex.nB[1] },
        uN2A: { value: tex.nA[2] },
        uN2B: { value: tex.nB[2] },
        uAmpScale: { value: 1 },
        uChopScale: { value: 1 }
      }),
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true
    });
    this.userData.decorShared = true;
    registerWallLightTarget(this);
  }
  dispose() {
    unregisterWallLightTarget(this);
    super.dispose();
  }
};
var sharedWaterMaterial = new WaterMaterial();
function createWaterMesh(raw) {
  const geo = new THREE2.BufferGeometry();
  geo.setAttribute("position", new THREE2.BufferAttribute(raw.vertices, 3));
  geo.setAttribute("normal", new THREE2.BufferAttribute(raw.normals, 3));
  geo.setAttribute("uv", new THREE2.BufferAttribute(raw.uvs, 2));
  geo.setAttribute("deep", new THREE2.BufferAttribute(raw.deep, 1));
  if (raw.border) geo.setAttribute("border", new THREE2.BufferAttribute(raw.border, 1));
  if (raw.spin) geo.setAttribute("spin", new THREE2.BufferAttribute(raw.spin, 2));
  geo.setIndex(new THREE2.BufferAttribute(raw.indices, 1));
  const mesh = new THREE2.Mesh(geo, sharedWaterMaterial);
  mesh.renderOrder = 10;
  return mesh;
}
export {
  WaterMaterial,
  createWaterMesh,
  sharedWaterMaterial
};
