// src/systems/swarm/TerrainSemantics.ts
var L1_CELL = 4;
var L1_R = 144;
var SIDE = Math.floor(L1_R * 2 / L1_CELL) + 1;
var SLOPE_GRAD = 1.5 / 4;
var CLIMB_DH = 1.5;
var WALL_GRAD = 3 / 4;
var FLAT_GRAD = 0.15;
var ASPECT_EPS = 0.25;
var RELIEF_DH = 1.2;
var REGION_DH = 0.75;
var REGION_DH_NARROW = 1.5;
var REGION_MIN_CELLS = 3;
var REGION_MIN_CHOKE = 1;
var REGION_MIN_CORRIDOR = 2;
var LOS_STEP = 2;
var LOS_CLEAR = 0.2;
var EYE_SHIP = 1.6;
var EYE_TARGET = 0.4;
var WIDTH_CAP = 3;
var Sem = {
  Neutral: 0,
  HighGround: 1,
  // 高地/制高
  Hollow: 2,
  // 低谷
  FrontSlope: 3,
  // 迎船坡（面向舰船 → 偏进攻）
  ReverseSlope: 4,
  // 背船坡（背对舰船 → 偏防御）
  Choke: 5,
  // 关口/隘口
  Corridor: 6,
  // 走廊
  Open: 7,
  // 开阔地
  Concealed: 8,
  // 隐蔽接近/盲区（LOS 被地形遮挡；v1 合并为一类）
  Cliff: 9,
  // 陡壁（硬边界）
  Water: 10,
  // 水（可走）
  Pit: 11
  // 坑（硬边界）
};
var SEM_NAMES = [
  "\u4E2D\u6027",
  "\u9AD8\u5730",
  "\u4F4E\u8C37",
  "\u8FCE\u8239\u5761",
  "\u80CC\u8239\u5761",
  "\u5173\u53E3",
  "\u8D70\u5ECA",
  "\u5F00\u9614\u5730",
  "\u9690\u853D",
  "\u9661\u58C1",
  "\u6C34",
  "\u5751"
];
var REGION_CLASSES = [
  Sem.HighGround,
  Sem.Hollow,
  Sem.FrontSlope,
  Sem.ReverseSlope,
  Sem.Choke,
  Sem.Corridor,
  Sem.Open,
  Sem.Concealed
];
var TerrainSemantics = class {
  ready = false;
  ax = 0;
  az = 0;
  sx = 0;
  sz = 0;
  buildMs = 0;
  /** 原始高度（采样） */
  rawH = new Float32Array(SIDE * SIDE);
  /** 平滑高度（3×3；梯度/坡向/LOS 用） */
  h = new Float32Array(SIDE * SIDE);
  cls = new Uint8Array(SIDE * SIDE);
  regionId = new Int16Array(SIDE * SIDE);
  /** n̂·d̂_ship（下坡方向 · 指向舰船；平地 = 0） */
  aspect = new Float32Array(SIDE * SIDE);
  slope = new Float32Array(SIDE * SIDE);
  width = new Float32Array(SIDE * SIDE);
  losBlocked = new Uint8Array(SIDE * SIDE);
  passable = new Uint8Array(SIDE * SIDE);
  hardRole = new Uint8Array(SIDE * SIDE);
  // pit / h<-1.2
  water = new Uint8Array(SIDE * SIDE);
  regionsArr = [];
  get isReady() {
    return this.ready;
  }
  get anchor() {
    return { x: this.ax, z: this.az };
  }
  // ============================================================
  // 构建（落地一次；换落点重算）
  // ============================================================
  build(sampler, cx, cz) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.ax = cx;
    this.az = cz;
    this.sx = cx - L1_R;
    this.sz = cz - L1_R;
    this.regionId.fill(-1);
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        const h = sampler.heightAt(x, z);
        const role = sampler.roleAt(x, z);
        this.rawH[i] = h;
        this.hardRole[i] = role === "pit" || h < -1.2 ? 1 : 0;
        this.water[i] = role === "liquid" ? 1 : 0;
        this.passable[i] = 1;
        this.cls[i] = Sem.Neutral;
        this.aspect[i] = 0;
        this.slope[i] = 0;
        this.width[i] = 0;
        this.losBlocked[i] = 0;
      }
    }
    this.smoothHeights();
    this.computeSlopeAspect();
    this.computeLos();
    const regions = this.classifyAndGrow();
    this.regionsArr = regions;
    this.ready = true;
    this.buildMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  }
  // ============================================================
  // 读表 API
  // ============================================================
  /** 主类（未就绪/表外 → Neutral） */
  classAt(x, z) {
    const i = this.indexAt(x, z);
    return i < 0 ? Sem.Neutral : this.cls[i];
  }
  /** 语义区块 id（未就绪/表外/无区块 → -1） */
  regionIdAt(x, z) {
    const i = this.indexAt(x, z);
    return i < 0 ? -1 : this.regionId[i];
  }
  /** 语义区块对象（无 → null） */
  regionAt(x, z) {
    const id = this.regionIdAt(x, z);
    return id < 0 ? null : this.regionsArr[id] ?? null;
  }
  /** 全部区块（只读） */
  regions() {
    return this.regionsArr;
  }
  /** 某类语义的区块（按面积降序） */
  regionsOf(cls) {
    return this.regionsArr.filter((r) => r.cls === cls).sort((a, b) => b.area - a.area);
  }
  /** 坡向：下坡方向 · 指向舰船（[-1,1]；平地/表外 = 0）——>0 迎船坡、<0 背船坡 */
  aspectAt(x, z) {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.aspect[i];
  }
  /** 坡度（m/m；未就绪/表外 = 0） */
  slopeAt(x, z) {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.slope[i];
  }
  /** 可站宽度 0~1（轴向连续可站格 / 4；同 TerrainScore 口径） */
  widthAt(x, z) {
    const i = this.indexAt(x, z);
    return i < 0 ? 0 : this.width[i];
  }
  /** 可走（非陡壁/坑；水可走） */
  isPassableAt(x, z) {
    const i = this.indexAt(x, z);
    return i >= 0 && this.passable[i] === 1;
  }
  /** 对舰船方向被地形遮挡（LOS blocked） */
  losBlockedAt(x, z) {
    const i = this.indexAt(x, z);
    return i >= 0 && this.losBlocked[i] === 1;
  }
  /** 隐蔽（可走 + LOS 被挡；偷袭/接近用） */
  concealedAt(x, z) {
    const i = this.indexAt(x, z);
    return i >= 0 && this.passable[i] === 1 && this.losBlocked[i] === 1;
  }
  /** 平滑高度（语义判据用的那个 h；未就绪/表外 → NaN） */
  smoothHeightAt(x, z) {
    const i = this.indexAt(x, z);
    return i < 0 ? NaN : this.h[i];
  }
  /** 原始采样高度（回读/评估用；未就绪/表外 → NaN） */
  rawHeightAt(x, z) {
    const i = this.indexAt(x, z);
    return i < 0 ? NaN : this.rawH[i];
  }
  /** 回读统计（评估用） */
  stats() {
    const hist = {};
    for (const n of SEM_NAMES) hist[n] = 0;
    let passable = 0, losBlocked = 0, concealed = 0;
    for (let i = 0; i < this.cls.length; i++) {
      const c = this.cls[i];
      hist[SEM_NAMES[c]]++;
      if (this.passable[i]) passable++;
      if (this.losBlocked[i]) losBlocked++;
      if (this.passable[i] && this.losBlocked[i]) concealed++;
    }
    const byCls = {};
    for (const r of this.regionsArr) {
      const key = SEM_NAMES[r.cls];
      const rec = byCls[key] ?? (byCls[key] = { count: 0, cells: 0, maxArea: 0 });
      rec.count++;
      rec.cells += r.area;
      rec.maxArea = Math.max(rec.maxArea, r.area);
    }
    return {
      buildMs: Math.round(this.buildMs * 100) / 100,
      side: SIDE,
      cells: SIDE * SIDE,
      passable,
      hist,
      regionCount: this.regionsArr.length,
      regionsByClass: byCls,
      losBlocked,
      concealed,
      anchor: { x: this.ax, z: this.az }
    };
  }
  clear() {
    this.ready = false;
    this.regionsArr = [];
    this.regionId.fill(-1);
  }
  // ============================================================
  // 内部：高度平滑 / 坡向 / LOS / 分类 / 扩块
  // ============================================================
  smoothHeights() {
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const jz = iz + dz;
          if (jz < 0 || jz >= SIDE) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const jx = ix + dx;
            if (jx < 0 || jx >= SIDE) continue;
            sum += this.rawH[jz * SIDE + jx];
            n++;
          }
        }
        this.h[iz * SIDE + ix] = sum / n;
      }
    }
  }
  computeSlopeAspect() {
    const cx = this.ax, cz = this.az;
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        const iL = ix > 0 ? i - 1 : i;
        const iRt = ix < SIDE - 1 ? i + 1 : i;
        const iU = iz > 0 ? i - SIDE : i;
        const iD = iz < SIDE - 1 ? i + SIDE : i;
        const gx = (this.h[iRt] - this.h[iL]) / (2 * L1_CELL);
        const gz = (this.h[iD] - this.h[iU]) / (2 * L1_CELL);
        const s = Math.hypot(gx, gz);
        this.slope[i] = s;
        if (s < 1e-6) {
          this.aspect[i] = 0;
          continue;
        }
        const dx = -gx / s, dz = -gz / s;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        const tx = cx - x, tz = cz - z;
        const td = Math.hypot(tx, tz);
        this.aspect[i] = td < 1 ? 0 : (dx * tx + dz * tz) / td;
      }
    }
  }
  /** 舰船 → 每格的高度场 LOS（采样步进；被中间地形挡住 → blocked） */
  computeLos() {
    const cx = this.ax, cz = this.az;
    const ci = this.indexAt(cx, cz);
    const eye = (ci < 0 ? 0 : this.h[ci]) + EYE_SHIP;
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        const dx = x - cx, dz = z - cz;
        const dist = Math.hypot(dx, dz);
        if (dist < L1_CELL) {
          this.losBlocked[i] = 0;
          continue;
        }
        const target = this.h[i] + EYE_TARGET;
        const steps = Math.max(2, Math.ceil(dist / LOS_STEP));
        let blocked = 0;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const px = cx + dx * t, pz = cz + dz * t;
          const lineH = eye + (target - eye) * t;
          if (this.heightNearestRaw(px, pz) > lineH + LOS_CLEAR) {
            blocked = 1;
            break;
          }
        }
        this.losBlocked[i] = blocked;
      }
    }
  }
  /** LOS 采样：用**原始高度**（平滑只服务坡向；窄缝/门洞必须保留真实落差） */
  heightNearestRaw(px, pz) {
    let ix = Math.round((px - this.sx - L1_CELL / 2) / L1_CELL);
    let iz = Math.round((pz - this.sz - L1_CELL / 2) / L1_CELL);
    if (ix < 0) ix = 0;
    else if (ix >= SIDE) ix = SIDE - 1;
    if (iz < 0) iz = 0;
    else if (iz >= SIDE) iz = SIDE - 1;
    return this.rawH[iz * SIDE + ix];
  }
  /** 外环（Chebyshev 半径 3 ≈ 12m）均值 */
  ringMean(ix, iz) {
    let sum = 0, n = 0;
    const r = 3;
    for (let dz = -r; dz <= r; dz++) {
      const jz = iz + dz;
      if (jz < 0 || jz >= SIDE) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const jx = ix + dx;
        if (jx < 0 || jx >= SIDE) continue;
        sum += this.rawH[jz * SIDE + jx];
        n++;
      }
    }
    return n > 0 ? sum / n : this.rawH[iz * SIDE + ix];
  }
  /** 分类 + BFS 扩块（返回区块表） */
  classifyAndGrow() {
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        if (this.hardRole[i]) {
          this.cls[i] = this.water[i] ? Sem.Water : Sem.Pit;
          this.passable[i] = 0;
          continue;
        }
        if (this.water[i]) {
          this.cls[i] = Sem.Water;
          this.passable[i] = 1;
        }
        let dh = 0;
        if (ix > 0) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i - 1]));
        if (ix < SIDE - 1) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i + 1]));
        if (iz > 0) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i - SIDE]));
        if (iz < SIDE - 1) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i + SIDE]));
        if (dh / L1_CELL > WALL_GRAD) {
          this.cls[i] = Sem.Cliff;
          this.passable[i] = 0;
          continue;
        }
        if (this.cls[i] === Sem.Water) continue;
        const climbable = (jx, jz) => {
          if (!this.walkableQuick(jx, jz)) return false;
          const j = jz * SIDE + jx;
          return Math.abs(this.rawH[j] - this.rawH[i]) <= CLIMB_DH;
        };
        let lx = 0;
        while (lx < WIDTH_CAP && ix - (lx + 1) >= 0 && climbable(ix - (lx + 1), iz)) lx++;
        let rx = 0;
        while (rx < WIDTH_CAP && ix + (rx + 1) < SIDE && climbable(ix + (rx + 1), iz)) rx++;
        let uz = 0;
        while (uz < WIDTH_CAP && iz - (uz + 1) >= 0 && climbable(ix, iz - (uz + 1))) uz++;
        let dz2 = 0;
        while (dz2 < WIDTH_CAP && iz + (dz2 + 1) < SIDE && climbable(ix, iz + (dz2 + 1))) dz2++;
        const runX = 1 + lx + rx, runZ = 1 + uz + dz2;
        const wCells = Math.min(runX, runZ);
        this.width[i] = Math.min(1, wCells / 4);
        let flankXL = false, flankXR = false, flankZU = false, flankZD = false;
        if (ix - (lx + 1) >= 0) {
          const j = i - (lx + 1);
          if (this.h[j] - this.h[i] >= 1.5) flankXL = true;
        }
        if (ix + (rx + 1) < SIDE) {
          const j = i + (rx + 1);
          if (this.h[j] - this.h[i] >= 1.5) flankXR = true;
        }
        if (iz - (uz + 1) >= 0) {
          const j = i - (uz + 1) * SIDE;
          if (this.h[j] - this.h[i] >= 1.5) flankZU = true;
        }
        if (iz + (dz2 + 1) < SIDE) {
          const j = i + (dz2 + 1) * SIDE;
          if (this.h[j] - this.h[i] >= 1.5) flankZD = true;
        }
        const flankX = flankXL || flankXR, flankZ = flankZU || flankZD;
        const s = this.slope[i];
        const relief = this.h[i] - this.ringMean(ix, iz);
        const asp = this.aspect[i];
        const choke = runX <= 1 && flankXL && flankXR || runZ <= 1 && flankZU && flankZD;
        if (s <= SLOPE_GRAD && choke) this.cls[i] = Sem.Choke;
        else if (s <= FLAT_GRAD && relief >= RELIEF_DH) this.cls[i] = Sem.HighGround;
        else if (s <= FLAT_GRAD && relief <= -RELIEF_DH) this.cls[i] = Sem.Hollow;
        else if (s >= SLOPE_GRAD && Math.abs(asp) >= ASPECT_EPS) {
          this.cls[i] = asp > 0 ? Sem.FrontSlope : Sem.ReverseSlope;
        } else if (s <= SLOPE_GRAD && wCells >= 2 && wCells <= 4 && (flankX || flankZ)) this.cls[i] = Sem.Corridor;
        else if (wCells >= 4) this.cls[i] = Sem.Open;
        else if (this.losBlocked[i]) this.cls[i] = Sem.Concealed;
        else this.cls[i] = Sem.Neutral;
        const c = this.cls[i];
        if (this.losBlocked[i] && (c === Sem.Open || c === Sem.Corridor || c === Sem.Neutral)) {
          this.cls[i] = Sem.Concealed;
        }
      }
    }
    const regions = [];
    const queue = new Int32Array(SIDE * SIDE);
    const inRegion = new Uint8Array(SIDE * SIDE);
    for (let seed = 0; seed < this.cls.length; seed++) {
      const cls = this.cls[seed];
      if (!REGION_CLASSES.includes(cls) || inRegion[seed]) continue;
      const tol = cls === Sem.Choke || cls === Sem.Corridor || cls === Sem.FrontSlope || cls === Sem.ReverseSlope ? REGION_DH_NARROW : REGION_DH;
      const minCells = cls === Sem.Choke ? REGION_MIN_CHOKE : cls === Sem.Corridor ? REGION_MIN_CORRIDOR : REGION_MIN_CELLS;
      let qh = 0, qt = 0, area = 0, aborted = false;
      queue[qt++] = seed;
      inRegion[seed] = 1;
      const acc = {
        area: 0,
        sumX: 0,
        sumZ: 0,
        sumAspect: 0,
        aspectN: 0,
        minH: this.h[seed],
        maxH: this.h[seed],
        minX: 1e9,
        maxX: -1e9,
        minZ: 1e9,
        maxZ: -1e9,
        repX: 0,
        repZ: 0,
        repV: cls === Sem.Hollow ? 1e9 : -1e9
      };
      while (qh < qt) {
        const i = queue[qh++];
        const ix = i % SIDE, iz = (i - ix) / SIDE;
        const x = this.sx + ix * L1_CELL + L1_CELL / 2;
        const z = this.sz + iz * L1_CELL + L1_CELL / 2;
        area++;
        acc.sumX += x;
        acc.sumZ += z;
        if (this.slope[i] >= SLOPE_GRAD) {
          acc.sumAspect += this.aspect[i];
          acc.aspectN++;
        }
        const h = this.h[i];
        if (h < acc.minH) acc.minH = h;
        if (h > acc.maxH) acc.maxH = h;
        if (x < acc.minX) acc.minX = x;
        if (x > acc.maxX) acc.maxX = x;
        if (z < acc.minZ) acc.minZ = z;
        if (z > acc.maxZ) acc.maxZ = z;
        const better = cls === Sem.Hollow ? h < acc.repV : h > acc.repV;
        if (better) {
          acc.repV = h;
          acc.repX = x;
          acc.repZ = z;
        }
        for (const j of [
          ix > 0 ? i - 1 : -1,
          ix < SIDE - 1 ? i + 1 : -1,
          iz > 0 ? i - SIDE : -1,
          iz < SIDE - 1 ? i + SIDE : -1
        ]) {
          if (j < 0 || inRegion[j]) continue;
          if (this.cls[j] !== cls) continue;
          if (Math.abs(this.h[j] - h) > tol) continue;
          inRegion[j] = 1;
          queue[qt++] = j;
        }
      }
      if (area < minCells) {
        for (let k = 0; k < qt; k++) {
          this.cls[queue[k]] = Sem.Neutral;
          inRegion[queue[k]] = 0;
        }
        aborted = true;
      }
      if (aborted) continue;
      const id = regions.length;
      for (let k = 0; k < qt; k++) this.regionId[queue[k]] = id;
      const cxx = acc.sumX / area, czz = acc.sumZ / area;
      let rx = acc.repX, rz = acc.repZ;
      if (cls !== Sem.HighGround && cls !== Sem.Hollow) {
        rx = cxx;
        rz = czz;
        let bestD = Infinity;
        for (let k = 0; k < qt; k++) {
          const j = queue[k];
          const jx = this.sx + j % SIDE * L1_CELL + L1_CELL / 2;
          const jz = this.sz + (j - j % SIDE) / SIDE * L1_CELL + L1_CELL / 2;
          const d = (jx - cxx) ** 2 + (jz - czz) ** 2;
          if (d < bestD) {
            bestD = d;
            rx = jx;
            rz = jz;
          }
        }
      }
      regions.push({
        id,
        cls,
        area,
        rx,
        rz,
        cx: cxx,
        cz: czz,
        aspect: acc.aspectN > 0 ? acc.sumAspect / acc.aspectN : 0,
        minH: acc.minH,
        maxH: acc.maxH,
        minX: acc.minX,
        maxX: acc.maxX,
        minZ: acc.minZ,
        maxZ: acc.maxZ
      });
    }
    return regions;
  }
  /** 快速可站（宽度探测用；水算可站、硬边界/陡壁不算） */
  walkableQuick(ix, iz) {
    if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) return false;
    const i = iz * SIDE + ix;
    if (this.hardRole[i]) return false;
    let dh = 0;
    if (ix > 0) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i - 1]));
    if (ix < SIDE - 1) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i + 1]));
    if (iz > 0) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i - SIDE]));
    if (iz < SIDE - 1) dh = Math.max(dh, Math.abs(this.h[i] - this.h[i + SIDE]));
    return dh / L1_CELL <= WALL_GRAD;
  }
  indexAt(x, z) {
    const ix = Math.round((x - this.sx - L1_CELL / 2) / L1_CELL);
    const iz = Math.round((z - this.sz - L1_CELL / 2) / L1_CELL);
    if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) return -1;
    return iz * SIDE + ix;
  }
};

// scripts/tmp/l1-debug.ts
var saddle = (x, z) => {
  const a = Math.exp(-((x + 14) ** 2 + (z + 40) ** 2) / (2 * 8 * 8));
  const b = Math.exp(-((x - 18) ** 2 + (z + 40) ** 2) / (2 * 8 * 8));
  return 20 * (a + b);
};
var l1 = new TerrainSemantics();
l1.build({ heightAt: saddle, roleAt: () => "ground" }, 0, 0);
for (const [x, z] of [[2, -38], [2, -42], [2, -34], [6, -38], [-2, -38]]) {
  console.log(
    `(${x},${z})`,
    SEM_NAMES[l1.classAt(x, z)],
    "w=",
    l1.widthAt(x, z).toFixed(2),
    "slope=",
    l1.slopeAt(x, z).toFixed(3),
    "aspect=",
    l1.aspectAt(x, z).toFixed(3),
    "h=",
    l1.smoothHeightAt(x, z).toFixed(2),
    "raw=",
    l1.rawHeightAt(x, z).toFixed(2),
    "pass=",
    l1.isPassableAt(x, z)
  );
}
