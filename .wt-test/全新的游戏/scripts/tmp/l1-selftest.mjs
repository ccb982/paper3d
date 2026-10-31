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
  smp = null;
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
    this.smp = sampler;
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
  /** 主类（未就绪/表外 → Neutral）。**纯初始地形语义**——不受任何挖改/构造影响。 */
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
  /** 下坡方向（单位向量；写入 out；平地/表外 → false）——坡向箭头的原始方向 */
  downhillInto(x, z, out) {
    const i = this.indexAt(x, z);
    if (i < 0) return false;
    const ix = i % SIDE, iz = (i - ix) / SIDE;
    const iL = ix > 0 ? i - 1 : i, iR = ix < SIDE - 1 ? i + 1 : i;
    const iU = iz > 0 ? i - SIDE : i, iD = iz < SIDE - 1 ? i + SIDE : i;
    const gx = (this.h[iR] - this.h[iL]) / (2 * L1_CELL);
    const gz = (this.h[iD] - this.h[iU]) / (2 * L1_CELL);
    const l = Math.hypot(gx, gz);
    if (l < 1e-6) {
      out.x = 0;
      out.z = 0;
      return false;
    }
    out.x = -gx / l;
    out.z = -gz / l;
    return true;
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
          if (this.rawH[j] - this.rawH[i] >= 1.5) flankXL = true;
        }
        if (ix + (rx + 1) < SIDE) {
          const j = i + (rx + 1);
          if (this.rawH[j] - this.rawH[i] >= 1.5) flankXR = true;
        }
        if (iz - (uz + 1) >= 0) {
          const j = i - (uz + 1) * SIDE;
          if (this.rawH[j] - this.rawH[i] >= 1.5) flankZU = true;
        }
        if (iz + (dz2 + 1) < SIDE) {
          const j = i + (dz2 + 1) * SIDE;
          if (this.rawH[j] - this.rawH[i] >= 1.5) flankZD = true;
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

// src/systems/swarm/HoleMask.ts
var MASK_CELL = 1;
var MASK_SIDE = L1_R * 2 / MASK_CELL;
var HOLE_MIN_MARK = 0.15;
var HoleMask = class {
  sx = 0;
  sz = 0;
  ready = false;
  src = null;
  depth = new Float32Array(MASK_SIDE * MASK_SIDE);
  get isReady() {
    return this.ready;
  }
  get side() {
    return MASK_SIDE;
  }
  get anchor() {
    return { x: this.sx + L1_R, z: this.sz + L1_R };
  }
  /** 建立掩码窗口（跟随落点）并全表首扫（接管"落地前已存在"的初始破坏） */
  build(src, cx, cz) {
    this.src = src;
    this.sx = cx - L1_R;
    this.sz = cz - L1_R;
    this.ready = true;
    this.refresh(cx, cz, L1_R + 2);
  }
  /** 深度读取（世界坐标 → 所在 1m 格；表外/未就绪 → 0） */
  depthAt(x, z) {
    if (!this.ready) return 0;
    const ix = Math.floor(x - this.sx), iz = Math.floor(z - this.sz);
    if (ix < 0 || iz < 0 || ix >= MASK_SIDE || iz >= MASK_SIDE) return 0;
    return this.depth[iz * MASK_SIDE + ix];
  }
  /** 该格是否算破坏（深度 ≥ 挖深阈值） */
  isDug(x, z) {
    return this.depthAt(x, z) >= HOLE_MIN_MARK;
  }
  /** ★★ 窗扫（任何挖掘后调用；r = 破坏半径米）：逐 1m 格点采样真源。
   *  @returns 该窗内新达到"破坏阈值"的格数 */
  refresh(x, z, r = 16) {
    if (!this.ready || !this.src) return 0;
    const ix0 = Math.max(0, Math.floor(x - r - this.sx));
    const iz0 = Math.max(0, Math.floor(z - r - this.sz));
    const ix1 = Math.min(MASK_SIDE - 1, Math.ceil(x + r - this.sx));
    const iz1 = Math.min(MASK_SIDE - 1, Math.ceil(z + r - this.sz));
    let n = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * MASK_SIDE + ix;
        const d = this.src.digDepthAt(this.sx + ix + 0.5, this.sz + iz + 0.5);
        if (d >= HOLE_MIN_MARK && this.depth[i] < HOLE_MIN_MARK) n++;
        this.depth[i] = d;
      }
    }
    return n;
  }
};

// src/systems/swarm/HoleTable.ts
var HOLE_MIN_DEPTH = 0.3;
var HOLE_FULL_DEPTH = 1;
var HOLE_NEAR_R = 40;
var HOLE_FAR_R = 90;
var COVER_FULL_HP = 400;
var COVER_HIDDEN_W = 1;
var COVER_OPEN_W = 0.35;
var COVER_HP_W = 0.5;
function perfNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
var HoleTable = class {
  scores = new Float32Array(MASK_SIDE * MASK_SIDE);
  // per-cell 分（>0 = 有效坑；-1 = 非坑）
  region = new Int16Array(MASK_SIDE * MASK_SIDE);
  // BFS 复用暂存
  holesArr = [];
  coversArr = [];
  claims = /* @__PURE__ */ new Map();
  lastSx = NaN;
  lastSz = NaN;
  get isReady() {
    return Number.isFinite(this.lastSx);
  }
  get holes() {
    return this.holesArr;
  }
  get covers() {
    return this.coversArr;
  }
  /** 清空（退出模式/换落点前） */
  clear() {
    this.scores.fill(-1);
    this.holesArr = [];
    this.coversArr = [];
    this.claims.clear();
    this.lastSx = NaN;
    this.lastSz = NaN;
  }
  /** ★ 占用坑洞（squadId 领取，ttl 毫秒后过期自动释放） */
  claim(holeId, squad, ttlMs = 15e3, nowMs = perfNow()) {
    this.claims.set(holeId, { squad, until: nowMs + ttlMs });
  }
  /** 释放占用 */
  release(holeId) {
    this.claims.delete(holeId);
  }
  /** 占用查询（0 = 空闲/已过期） */
  claimedBy(holeId, nowMs = perfNow()) {
    const c = this.claims.get(holeId);
    return c && c.until > nowMs ? c.squad : 0;
  }
  /** ★★ 重排（每个低频拍调一次 = "动态不断修改"）：
   *  1m 深度场 → 逐格打分（深×近）→ 连通块合并成坑洞 → 按分降序；
   *  掩体（构造工事）同拍从输入快照重算（遮蔽×近×血量）。
   *  @param nowMs 占用过期判定时钟（测试可注入） */
  rebuild(mask, sem, px, pz, covers = [], nowMs = perfNow()) {
    this.scores.fill(-1);
    this.coversArr = covers.map((c) => {
      const maxHp = c.maxHp ?? COVER_FULL_HP;
      const hpRatio = Math.max(0, Math.min(1, c.hp / (maxHp || COVER_FULL_HP)));
      const dist = Math.hypot(c.x - px, c.z - pz);
      const prox = Math.min(1, Math.max(0, (HOLE_FAR_R - dist) / (HOLE_FAR_R - HOLE_NEAR_R)));
      const hpF = 1 - COVER_HP_W + COVER_HP_W * hpRatio;
      return {
        x: c.x,
        z: c.z,
        hp: c.hp,
        maxHp,
        variant: c.variant,
        heading: c.heading,
        hidden: c.hidden,
        dist,
        score: (c.hidden ? COVER_HIDDEN_W : COVER_OPEN_W) * prox * hpF
      };
    }).sort((a, b) => b.score - a.score);
    for (const [id, c] of this.claims) if (c.until <= nowMs) this.claims.delete(id);
    if (!mask || !mask.isReady || !sem || !sem.isReady) {
      this.holesArr = [];
      return;
    }
    const sx = mask.anchor.x - L1_R, sz = mask.anchor.z - L1_R;
    this.lastSx = sx;
    this.lastSz = sz;
    for (let iz = 0; iz < MASK_SIDE; iz++) {
      for (let ix = 0; ix < MASK_SIDE; ix++) {
        const i = iz * MASK_SIDE + ix;
        const wx = sx + ix + 0.5, wz = sz + iz + 0.5;
        const depth = mask.depthAt(wx, wz);
        if (depth < HOLE_MIN_DEPTH) continue;
        if (!sem.isPassableAt(wx, wz)) continue;
        const dist = Math.hypot(wx - px, wz - pz);
        const depthF = Math.min(1, Math.max(0, (depth - HOLE_MIN_DEPTH) / (HOLE_FULL_DEPTH - HOLE_MIN_DEPTH)));
        const proxF = Math.min(1, Math.max(0, (HOLE_FAR_R - dist) / (HOLE_FAR_R - HOLE_NEAR_R)));
        this.scores[i] = depthF * proxF;
      }
    }
    this.region.fill(-1);
    const list = [];
    for (let iz = 0; iz < MASK_SIDE; iz++) {
      for (let ix = 0; ix < MASK_SIDE; ix++) {
        const start = iz * MASK_SIDE + ix;
        if (this.scores[start] <= 0 || this.region[start] >= 0) continue;
        const que = [start];
        this.region[start] = start;
        let q = 0, n = 0, sumD = 0, maxD = 0, sumX = 0, sumZ = 0;
        let best = -1, bx = 0, bz = 0;
        while (q < que.length) {
          const c = que[q++];
          const cix = c % MASK_SIDE, ciz = (c - cix) / MASK_SIDE;
          const wx = sx + cix + 0.5, wz = sz + ciz + 0.5;
          const d = mask.depthAt(wx, wz);
          n++;
          sumD += d;
          sumX += wx;
          sumZ += wz;
          if (d > maxD) maxD = d;
          if (this.scores[c] > best) {
            best = this.scores[c];
            bx = wx;
            bz = wz;
          }
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nxi = cix + dx, nzi = ciz + dz;
            if (nxi < 0 || nzi < 0 || nxi >= MASK_SIDE || nzi >= MASK_SIDE) continue;
            const ni = nzi * MASK_SIDE + nxi;
            if (this.scores[ni] > 0 && this.region[ni] < 0) {
              this.region[ni] = start;
              que.push(ni);
            }
          }
        }
        const dist = Math.hypot(bx - px, bz - pz);
        list.push({
          id: start,
          cells: n,
          maxDepth: maxD,
          avgDepth: sumD / n,
          cx: bx,
          cz: bz,
          mx: sumX / n,
          mz: sumZ / n,
          score: Math.max(0, best),
          dist,
          claimedBy: this.claimedBy(start, nowMs)
        });
      }
    }
    this.holesArr = list.sort((a, b) => b.score - a.score);
  }
  /** 读点：坑洞分（世界坐标；非坑/表外 = 0） */
  scoreAt(x, z) {
    if (!Number.isFinite(this.lastSx)) return 0;
    const ix = Math.floor(x - this.lastSx), iz = Math.floor(z - this.lastSz);
    if (ix < 0 || iz < 0 || ix >= MASK_SIDE || iz >= MASK_SIDE) return 0;
    return Math.max(0, this.scores[iz * MASK_SIDE + ix]);
  }
  /** ★ 敌人取坑：分数最高的 n 个坑洞（可加半径筛选 / 只看空闲） */
  topHoles(k, maxDist = Infinity, freeOnly = false) {
    const out = [];
    for (const h of this.holesArr) {
      if (h.dist > maxDist) continue;
      if (freeOnly && h.claimedBy !== 0) continue;
      out.push(h);
      if (out.length >= k) break;
    }
    return out;
  }
};

// scripts/l1-selftest.ts
var pass = 0;
var fail = 0;
function ok(cond, msg, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL  ${msg}${extra ? "  \u2190 " + extra : ""}`);
  }
}
function field(hAt, roleAt = () => "ground") {
  return { heightAt: hAt, roleAt };
}
function histOf(s) {
  return SEM_NAMES.map((n) => `${n}:${s.hist[n]}`).join("  ");
}
{
  console.log("\n[1] \u5E73\u539F");
  const l1 = new TerrainSemantics();
  l1.build(field(() => 0), 0, 0);
  const s = l1.stats();
  console.log("  stats:", JSON.stringify({ ms: s.buildMs, passable: s.passable, regions: s.regionCount, concealed: s.concealed }));
  console.log("  hist: ", histOf(s));
  ok(s.hist["\u5F00\u9614\u5730"] > s.passable * 0.5, "\u5F00\u9614\u5730\u5360\u53EF\u7AD9\u683C >50%", `\u5F00\u9614\u5730=${s.hist["\u5F00\u9614\u5730"]} passable=${s.passable}`);
  ok(l1.regionsOf(Sem.HighGround).length === 0, "\u65E0\u9AD8\u5730\u533A\u5757");
  ok(l1.regionsOf(Sem.Choke).length === 0, "\u65E0\u5173\u53E3\u533A\u5757");
}
{
  console.log("\n[2] \u9AD8\u65AF\u5C71\uFF08\u5CF0\u5728\u8230\u8239\u5317\u4FA7 60m\uFF0C\u9AD8 25m\uFF0C\u03C3=30\uFF09");
  const hill = (x, z) => {
    const r2 = x * x + (z + 60) * (z + 60);
    return 25 * Math.exp(-r2 / (2 * 30 * 30));
  };
  const l1 = new TerrainSemantics();
  l1.build(field(hill), 0, 0);
  const s = l1.stats();
  console.log("  stats:", JSON.stringify({ ms: s.buildMs, regions: s.regionCount, concealed: s.concealed }));
  console.log("  hist: ", histOf(s));
  const highs = l1.regionsOf(Sem.HighGround);
  const top = highs[0];
  if (top) console.log(`  \u9AD8\u5730\u533A\u5757: area=${top.area} rep=(${top.rx.toFixed(0)},${top.rz.toFixed(0)}) h=[${top.minH.toFixed(1)},${top.maxH.toFixed(1)}]`);
  ok(highs.length > 0, "\u5B58\u5728\u9AD8\u5730\u533A\u5757");
  ok(!!top && Math.hypot(top.rx - 0, top.rz + 60) <= 16, "\u9AD8\u5730\u533A\u5757\u4EE3\u8868\u70B9\u5728\u5C71\u9876 16m \u5185", top ? `rep=(${top.rx.toFixed(0)},${top.rz.toFixed(0)})` : "none");
  ok(s.hist["\u8FCE\u8239\u5761"] > 0, "\u6709\u8FCE\u8239\u5761\u683C");
  ok(s.hist["\u80CC\u8239\u5761"] > 0, "\u6709\u80CC\u8239\u5761\u683C");
  let aspFront = 0, aspBack = 0, nF = 0, nB = 0;
  for (let z = -140; z <= 140; z += 4) {
    for (let x = -140; x <= 140; x += 4) {
      const c = l1.classAt(x, z);
      if (c === Sem.FrontSlope) {
        aspFront += l1.aspectAt(x, z);
        nF++;
      }
      if (c === Sem.ReverseSlope) {
        aspBack += l1.aspectAt(x, z);
        nB++;
      }
    }
  }
  ok(nF > 0 && aspFront / nF > 0.3, `\u8FCE\u8239\u5761\u5E73\u5747\u5761\u5411 > +0.3\uFF08n=${nF}\uFF09`, `mean=${(aspFront / Math.max(1, nF)).toFixed(2)}`);
  ok(nB > 0 && aspBack / nB < -0.3, `\u80CC\u8239\u5761\u5E73\u5747\u5761\u5411 < -0.3\uFF08n=${nB}\uFF09`, `mean=${(aspBack / Math.max(1, nB)).toFixed(2)}`);
  ok(l1.concealedAt(0, -140), "\u5C71\u540E (0,-140) \u5224\u5B9A\u4E3A\u9690\u853D\uFF08LOS \u88AB\u5C71\u6321\uFF09");
  ok(!l1.concealedAt(0, 80), "\u8230\u8239\u5357\u4FA7 (0,80) \u4E0D\u9690\u853D");
}
{
  console.log("\n[3] \u6A2A\u810A\uFF08z=-42..-38\uFF0C\u9AD8 20m\uFF09+ \u5355\u683C\u95E8\uFF08x=2\uFF09");
  const ridge = (x, z) => {
    const inBand = Math.abs(z + 40) <= 3;
    if (inBand && Math.abs(x - 2) < 2) return 0;
    return inBand ? 20 : 0;
  };
  const l1 = new TerrainSemantics();
  l1.build(field(ridge), 0, 0);
  const s = l1.stats();
  console.log("  stats:", JSON.stringify({ ms: s.buildMs, regions: s.regionCount, concealed: s.concealed }));
  console.log("  hist: ", histOf(s));
  ok(l1.concealedAt(30, -60), "\u810A\u540E (30,-60) \u9690\u853D");
  ok(!l1.concealedAt(2, -60), "\u95E8\u540E (2,-60) \u4E0D\u9690\u853D\uFF08\u53EF\u7A7F\u8FC7\u95E8\u770B\u5230\uFF09");
  ok(s.hist["\u9690\u853D"] > 0, "\u6709\u9690\u853D\u683C\uFF08\u80CC\u810A\u4FA7\uFF09");
}
{
  console.log("\n[3b] \u53CC\u5CF0\u978D\u90E8\uFF08\u4E24\u5CF0 (-14,-40)/(18,-40) \u9AD8 20m\uFF0C\u03C3=8\uFF09");
  const saddle = (x, z) => {
    const a = Math.exp(-((x + 14) ** 2 + (z + 40) ** 2) / (2 * 8 * 8));
    const b = Math.exp(-((x - 18) ** 2 + (z + 40) ** 2) / (2 * 8 * 8));
    return 20 * (a + b);
  };
  const l1 = new TerrainSemantics();
  l1.build(field(saddle), 0, 0);
  const s = l1.stats();
  console.log("  stats:", JSON.stringify({ ms: s.buildMs, regions: s.regionCount }));
  console.log("  hist: ", histOf(s));
  const chokes = l1.regionsOf(Sem.Choke);
  for (const r of chokes.slice(0, 3)) console.log(`  \u5173\u533A\u5757: area=${r.area} rep=(${r.rx.toFixed(0)},${r.rz.toFixed(0)}) h=[${r.minH.toFixed(1)},${r.maxH.toFixed(1)}]`);
  ok(chokes.length > 0, "\u5B58\u5728\u5173\u53E3\u533A\u5757\uFF08\u978D\u90E8\uFF09");
  ok(!!chokes[0] && Math.abs(chokes[0].rx - 2) <= 10 && Math.abs(chokes[0].rz + 40) <= 12, "\u5173\u53E3\u533A\u5757\u5728\u4E24\u5CF0\u4E4B\u95F4", chokes[0] ? `rep=(${chokes[0].rx.toFixed(0)},${chokes[0].rz.toFixed(0)})` : "none");
  ok(l1.isPassableAt(2, -40), "\u978D\u90E8\u53EF\u8D70");
}
{
  console.log("\n[4] \u5751 / \u6C34");
  const roleAt = (x, z) => {
    if (x > 40 && x < 80 && z > 40 && z < 80) return "pit";
    if (x < -40 && x > -80 && z > 40 && z < 80) return "liquid";
    return "ground";
  };
  const l1 = new TerrainSemantics();
  l1.build(field(() => 0, roleAt), 0, 0);
  const s = l1.stats();
  console.log("  hist: ", histOf(s));
  ok(l1.classAt(60, 60) === Sem.Pit, "\u5751\u533A \u2192 \u5751\u7C7B");
  ok(l1.classAt(-60, 60) === Sem.Water, "\u6C34\u533A \u2192 \u6C34\u7C7B");
  ok(!l1.isPassableAt(60, 60), "\u5751\u4E0D\u53EF\u8D70");
  ok(l1.isPassableAt(-60, 60), "\u6C34\u53EF\u8D70");
}
{
  console.log("\n[5] \u5751\u6D1E\uFF08\u63A9\u7801\u72EC\u7ACB + \u654C\u7528\u52A8\u6001\u516C\u5F0F\u8868\uFF09");
  const mask = new HoleMask();
  const inA = (x, z) => x > -44 && x < -16 && z > -44 && z < -16;
  const digOf = (x, z) => x > 2 && x < 3 && z > 2 && z < 3 ? 1.2 : inA(x, z) ? 0.6 : 0;
  mask.build({ digDepthAt: (x, z) => digOf(x, z) }, 0, 0);
  const sem = new TerrainSemantics();
  sem.build(field(() => 0), 0, 0);
  const holes = new HoleTable();
  ok(mask.isDug(-30, -30), "\u63A9\u7801\u8BC6\u522B\u521D\u59CB\u7834\u574F\u683C");
  ok(Math.abs(mask.depthAt(-30, -30) - 0.6) < 0.01, "\u63A9\u7801\u8BB0\u5F55\u6316\u6398\u6DF1\u5EA6");
  ok(sem.classAt(-30, -30) === Sem.Open, "L1 \u7EAF\u521D\u59CB\uFF1A\u7834\u574F\u683C\u4ECD\u662F\u5E73\u5730\u7C7B\uFF08\u4E0D\u6539\u53D8\u8BED\u4E49\u7C7B\uFF09");
  ok(sem.stats().hist["\u5F00\u9614\u5730"] === 5329, "L1 hist \u65E0\u7834\u574F\u6876\uFF0812 \u7C7B\uFF09");
  ok(SEM_NAMES.length === 12, "SEM_NAMES \u5171 12 \u7C7B\uFF08\u6218\u58D5\u5DF2\u5265\u79BB\uFF09");
  holes.rebuild(mask, sem, 3, 3);
  const sProbe = holes.scoreAt(2, 2);
  const sMid = holes.scoreAt(-30, -30);
  ok(sProbe > 0.9, `\u8FD1\u5904\u6EE1\u6DF1\u5751 \u2192 \u9AD8\u5206\uFF08${sProbe.toFixed(3)}\uFF09`);
  ok(sMid < sProbe, `\u66F4\u6D45\u66F4\u8FDC\u7684\u7A9D\u5206\u66F4\u4F4E\uFF08${sMid.toFixed(3)} < ${sProbe.toFixed(3)}\uFF09`);
  const hole = holes.holes[0];
  ok(!!hole && hole.cells === 1 && Math.abs(hole.maxDepth - 1.2) < 0.01, "\u6EE1\u6DF1\u63A2\u9488\u72EC\u7ACB\u6210\u5751\uFF08cells=1\uFF0C\u6700\u6DF1 1.2\uFF09");
  ok(hole.score === sProbe, "\u5751\u6D1E\u5206 = \u5757\u5185\u6700\u9AD8\u683C\u5206");
  holes.rebuild(mask, sem, 500, 500);
  ok(holes.scoreAt(2, 2) <= 1e-3, `\u8FDC\u5904\u6EE1\u6DF1\u5751\u5206\u584C\u4E3A 0\uFF08${holes.scoreAt(2, 2).toFixed(3)}\uFF09`);
  const holeFar = holes.holes[0];
  ok(!holeFar || holeFar.score <= 1e-3, "\u8FDC\u79BB\u73A9\u5BB6 \u2192 \u65E0\u6709\u6548\u9AD8\u5206\u5751\u6D1E\u6761\u76EE");
  holes.rebuild(mask, sem, 3, 3);
  const sBack = holes.scoreAt(2, 2);
  ok(sBack > 0.9, "\u52A8\u6001\u8868\u968F\u73A9\u5BB6\u9760\u8FD1\u56DE\u5347");
  const probeId = holes.holes[0].id;
  holes.rebuild(mask, sem, 3, 3);
  ok(holes.holes[0].id === probeId, "\u5751\u6D1E id \u8DE8\u91CD\u6392\u7A33\u5B9A\uFF08= \u5757\u5185\u6700\u5C0F\u683C\u7D22\u5F15\uFF09");
  holes.claim(probeId, 7, 1e3, 0);
  holes.rebuild(mask, sem, 3, 3, [], 500);
  ok(holes.holes[0].claimedBy === 7, "\u5360\u7528\u6807\u6CE8\u968F\u91CD\u6392\u8BFB\u53D6");
  holes.rebuild(mask, sem, 3, 3, [], 2500);
  ok(holes.holes[0].claimedBy === 0, "\u5360\u7528\u8FC7\u671F\u81EA\u52A8\u91CA\u653E");
  const shallow = new HoleMask();
  shallow.build({ digDepthAt: () => 0.1 }, 0, 0);
  shallow.refresh(50, 50, 40);
  holes.rebuild(shallow, sem, 0, 0);
  ok(holes.holes.length === 0, "\u6D45\u5751\uFF08<0.3m\uFF09\u4E0D\u6784\u6210\u6709\u6548\u5751\u6D1E");
  ok(holes.scoreAt(50, 50) === 0, "\u6D45\u5751\u683C\u5206 = 0");
  ok(HOLE_FULL_DEPTH > HOLE_MIN_DEPTH, "\u6EE1\u5206\u5E03\u6DF1 > \u95E8\u69DB");
  ok(HOLE_NEAR_R < HOLE_FAR_R, "\u8FD1\u6EE1 > \u8FDC\u96F6\u534A\u5F84");
  const covs = [
    { x: 10, z: 10, hp: 400, variant: "cover", heading: 0, hidden: true },
    // 近 + 挡射界
    { x: 12, z: 12, hp: 400, variant: "cover", heading: 0, hidden: false },
    // 近 + 暴露
    { x: 300, z: 300, hp: 400, variant: "wall", heading: 0, hidden: true }
    // 远（距离因子=0）
  ];
  holes.rebuild(mask, sem, 0, 0, covs);
  const cs = holes.covers;
  ok(cs.length === 3, "\u63A9\u4F53\u6761\u76EE\u968F\u91CD\u6392\u52A8\u6001\u66F4\u65B0");
  ok(cs[0].x === 10 && cs[0].hidden, "\u906E\u853D\u8FD1\u63A9\u4F53\u6392\u7B2C\u4E00");
  ok(
    cs[0].score > cs[1].score && cs[1].score > cs[2].score,
    `\u63A9\u4F53\u5206\uFF1A\u906E\u853D>\u66B4\u9732>\u8FDC\uFF08${cs[0].score.toFixed(2)}/${cs[1].score.toFixed(2)}/${cs[2].score.toFixed(2)}\uFF09`
  );
  holes.rebuild(mask, sem, 0, 0, []);
  ok(holes.covers.length === 0, "\u63A9\u4F53\u9500\u6BC1\u540E\u52A8\u6001\u8868\u6E05\u7A7A");
  holes.rebuild(mask, sem, 0, 0, [{ x: 10, z: 10, hp: 200, variant: "cover", heading: 0, hidden: true }]);
  ok(Math.abs(holes.covers[0].score - 0.75) < 0.01, `\u534A\u8840\u63A9\u4F53\u964D\u6743\uFF08${holes.covers[0].score.toFixed(2)} = 0.75\uFF09`);
  console.log(
    "  \u63A2\u9488(\u8FD1\u6EE1\u6DF1) =",
    sProbe.toFixed(3),
    " \u4E2D\u7A9D =",
    sMid.toFixed(3),
    " \u56DE\u8868 =",
    sBack.toFixed(3),
    " \u5751\u6D1E\u6570 =",
    holes.holes.length
  );
}
console.log(`
==== \u7ED3\u679C\uFF1APASS ${pass} / FAIL ${fail} ====`);
if (fail > 0) process.exit(1);
