import puppeteer from 'puppeteer-core';
const mk = () => ({
  meta: { version: '0.2.0', day: 1, seed: 4242, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: Array.from({ length: 30 }, () => Array(30).fill(null)), ship: Array.from({ length: 8 }, () => Array(10).fill(null)), player: Array.from({ length: 4 }, () => Array(6).fill(null)) },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false },
  outOfRun: { owned: {} },
  story: { flags: {}, events: {} },
});
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: false,
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1280,800'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message ?? e)));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), mk());
await page.goto('http://localhost:5199/?perf=1', { waitUntil: 'domcontentloaded' });
await page.bringToFront();
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 5500));
await page.evaluate(() => window.__ppMode().finishDock());
await new Promise((r) => setTimeout(r, 3000));

const res = await page.evaluate(() => {
  const m = window.__ppMode();
  const p = m.player.position;
  const ship = m.ship?.position;
  const muzzle = { x: p.x, y: p.y + 1.1, z: p.z };
  const cp = m.crosshairPoint();
  const dir = m.aimDirectionFromMuzzle(muzzle);
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const d = Math.hypot(cp.x - muzzle.x, cp.y - muzzle.y, cp.z - muzzle.z);
  const shipD = ship ? Math.hypot(cp.x - ship.x, cp.y - ship.y, cp.z - ship.z) : -1;
  // 模拟开火（走真实入口）
  let before = m.bullets?.activeCount ?? -1;
  m.firePlayerBullet();
  const after = m.bullets?.activeCount ?? -1;
  // 连发 3 次，检查无异常
  for (let i = 0; i < 3; i++) m.firePlayerBullet();
  return { phase: m.phase, playerPos: p, shipPos: ship, shipD, cp, dir, len, dist: d, bulletsBefore: before, bulletsAfter: after };
});
console.log('open-z view:', JSON.stringify(res));

// ★ 相机转向舰船方向（船是 camp='player'）：准星压船 → 落点不得是船体表面
await page.evaluate(() => {
  const m = window.__ppMode();
  m.cameraCtrl.yaw = Math.PI / 2;      // forward = (-1,0) → 朝 -x（船的方向）
  m.cameraCtrl.targetYaw = Math.PI / 2;
  m.cameraCtrl.pitch = 0;
  m.cameraCtrl.targetPitch = 0;
});
await new Promise((r) => setTimeout(r, 800));
const res2 = await page.evaluate(() => {
  const m = window.__ppMode();
  const p = m.player.position;
  const ship = m.ship.position;
  const muzzle = { x: p.x, y: p.y + 1.1, z: p.z };
  const cp = m.crosshairPoint();
  const dir = m.aimDirectionFromMuzzle(muzzle);
  const cam = m.camera.position;
  // 射线是否穿过船体近似球（camp player 的船）：比较落点与船心距离
  const shipD = Math.hypot(cp.x - ship.x, cp.y - ship.y, cp.z - ship.z);
  return { camPos: cam, cp, dir, len: Math.hypot(dir.x, dir.y, dir.z), shipD, shipPos: ship };
});
console.log('facing-ship view:', JSON.stringify(res2));

// ★ 蜂群锁准星验证：?enemies=150 压测代理 → 准星对准最近代理，落点应为该代理
await page.goto('http://localhost:5199/?perf=1&enemies=150', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 5500));
await page.evaluate(() => window.__ppMode().finishDock());
await new Promise((r) => setTimeout(r, 9000));
// 追瞄：每 80ms 重新把相机对准最新代理位置（代理在移动），最后一次后立即采样
for (let k = 0; k < 4; k++) {
  await page.evaluate(() => {
    const m = window.__ppMode();
    const sw = m.swarm;
    let bi = -1, bd = Infinity;
    const px = m.player.position.x, pz = m.player.position.z;
    for (let i = 0; i < sw.count; i++) {
      const dx = sw.agentX(i) - px, dz = sw.agentZ(i) - pz;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    window.__probeAgent = bi;
    if (bi < 0) return;
    const ax = sw.agentX(bi), ay = sw.agentY(bi) + 0.9, az = sw.agentZ(bi);
    const dx = ax - px, dz = az - pz;
    const yaw = Math.atan2(-dx, -dz);
    const cam = m.camera.position;
    const horiz = Math.hypot(ax - cam.x, az - cam.z);
    const pitch = -Math.atan2(ay - cam.y, horiz);
    m.cameraCtrl.yaw = yaw; m.cameraCtrl.targetYaw = yaw;
    m.cameraCtrl.pitch = pitch; m.cameraCtrl.targetPitch = pitch;
  });
  await new Promise((r) => setTimeout(r, 80));
}
const res3 = await page.evaluate(() => {
  const m = window.__ppMode();
  const sw = m.swarm, bi = window.__probeAgent;
  if (bi < 0 || sw.count === 0) return { agents: sw.count, hit: false };
  const target = { x: sw.agentX(bi), y: sw.agentY(bi) + 0.9, z: sw.agentZ(bi) };
  const cp = m.crosshairPoint();
  const err = Math.hypot(cp.x - target.x, cp.y - target.y, cp.z - target.z);
  const p = m.player.position;
  const dir = m.aimDirectionFromMuzzle({ x: p.x, y: p.y + 1.1, z: p.z });
  const toT = { x: target.x - p.x, y: target.y - (p.y + 1.1), z: target.z - p.z };
  const tl = Math.hypot(toT.x, toT.y, toT.z);
  const dot = (dir.x * toT.x + dir.y * toT.y + dir.z * toT.z) / (tl || 1);
  return { agents: sw.count, idx: bi, target, cp, lockErr: err, dirDotTarget: dot };
});
console.log('swarm-lock view:', JSON.stringify(res3));
console.log('pageerrors:', errs.length ? errs : 'none');
await browser.close();