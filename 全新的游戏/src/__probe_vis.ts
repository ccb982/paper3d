// __probe_vis.ts —— 地面梯形 vs 真 3D 视锥：错杀/漏杀实测（临时探针）
import * as THREE from 'three';

function trapezoid(cam: THREE.Camera, maxDist: number) {
  cam.updateMatrixWorld();
  const pts: { x: number; z: number }[] = [];
  const tmp = new THREE.Vector3();
  for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as Array<[number, number]>) {
    tmp.set(nx, ny, 1).unproject(cam);
    const dir = tmp.sub(cam.position).normalize();
    let px: number, pz: number;
    if (Math.abs(dir.y) < 1e-6) {
      const hl = Math.hypot(dir.x, dir.z);
      px = cam.position.x + (hl > 1e-6 ? dir.x / hl : 0) * maxDist;
      pz = cam.position.z + (hl > 1e-6 ? dir.z / hl : 0) * maxDist;
    } else {
      const t = -cam.position.y / dir.y;
      if (t > 0 && t <= maxDist) {
        px = cam.position.x + dir.x * t;
        pz = cam.position.z + dir.z * t;
      } else {
        const hl = Math.hypot(dir.x, dir.z);
        px = cam.position.x + (hl > 1e-6 ? dir.x / hl : 0) * maxDist;
        pz = cam.position.z + (hl > 1e-6 ? dir.z / hl : 0) * maxDist;
      }
    }
    pts.push({ x: px, z: pz });
  }
  return pts;
}

/** 梯形内判定（复刻 RasterMap.queryFrustum 的行扫描区间） */
function inTrap(pts: { x: number; z: number }[], x: number, z: number): boolean {
  const zMin = Math.min(...pts.map((p) => p.z));
  const zMax = Math.max(...pts.map((p) => p.z));
  if (z < zMin || z > zMax) return false;
  const xs: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a.z <= z && b.z >= z) || (a.z >= z && b.z <= z)) {
      if (Math.abs(b.z - a.z) < 1e-9) { xs.push(a.x); continue; }
      const t = (z - a.z) / (b.z - a.z);
      xs.push(a.x + (b.x - a.x) * t);
    }
  }
  if (xs.length < 2) return false;
  return x >= Math.min(xs[0], xs[1]) && x <= Math.max(xs[0], xs[1]);
}

const MAXD = 140;
const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
const projScreen = new THREE.Matrix4();

console.log('════ 地面梯形 vs 真 3D 视锥（真实 TPS 相机：玩家身后 4.2m，高 1.2m）════');
console.log(' pitch | 梯形面积 | 真视锥内地面点数 | 梯形漏掉(误杀) | 梯形多收 | 判定');
for (const pitchDeg of [-60, -40, -20, -7, 0, 7, 20, 40, 60]) {
  const pitch = (pitchDeg * Math.PI) / 180;
  // 相机位置：玩家在原点，相机在玩家身后 4.2m、高 1.2m（近似 TPS）
  const dist = 4.2;
  cam.position.set(0, 1.2, dist);
  cam.lookAt(0, 1.2 + Math.tan(pitch) * -dist, 0);
  cam.updateMatrixWorld();
  const pts = trapezoid(cam, MAXD);
  projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projScreen);

  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.z - b.x * a.z;
  }
  area = Math.abs(area) / 2;

  // 扫描相机前方地面网格：真视锥内 vs 梯形内
  let inTrue = 0, inTrapOnly = 0, missed = 0;
  const sph = new THREE.Sphere(new THREE.Vector3(), 0.6);
  for (let gx = -120; gx <= 120; gx += 2) {
    for (let gz = -140; gz <= 0; gz += 2) {
      sph.center.set(gx, 0, gz);
      const t = frustum.intersectsSphere(sph);
      const p = inTrap(pts, gx, gz);
      if (t) {
        inTrue++;
        if (!p) missed++;
      } else if (p) inTrapOnly++;
    }
  }
  const verdict = missed > 0 ? `✘ 误杀 ${missed}` : inTrapOnly > 0 ? `⚠ 多收 ${inTrapOnly}` : '✔ 一致';
  console.log(
    ` ${String(pitchDeg).padStart(4)}° | ${area.toFixed(0).padStart(7)}m² | ${String(inTrue).padStart(12)} |` +
    ` ${String(missed).padStart(12)} | ${String(inTrapOnly).padStart(8)} | ${verdict}`,
  );
}
