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
await new Promise((r) => setTimeout(r, 2500));

// 单次开火全程采样：出膛(小) → 臂展(常规) → 临近落点(放大) → 过点(缩回)
const hist = await page.evaluate(() => new Promise((resolve) => {
  const m = window.__ppMode();
  m.firePlayerBullet();
  const b = m.entities.allBases().find((x) => x.entity.kind === 'bullet' && x.isActive);
  if (!b) { resolve({ err: 'no bullet' }); return; }
  const rec = [];
  let n = 0;
  const step = () => {
    const p = b.entity.position;
    const t = b.target;
    rec.push({
      armed: b.armed, bulged: b.bulged, active: b.isActive,
      d: t ? +Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z).toFixed(2) : -1,
    });
    n++;
    if (n < 90 && b.isActive) requestAnimationFrame(step);
    else resolve(rec);
  };
  requestAnimationFrame(step);
}));
if (hist.err) console.log('ERR', hist.err);
else {
  const first = hist[0];
  const armedAt = hist.find((h) => h.armed);
  const bulgeOn = hist.find((h) => h.bulged);
  const bulgeOff = hist.find((h, i) => i > hist.indexOf(bulgeOn ?? hist[0]) && !h.bulged && bulgeOn);
  const last = hist[hist.length - 1];
  console.log('frames:', hist.length, '| first:', JSON.stringify(first));
  console.log('armed at d≈', armedAt ? armedAt.d : '?', '| bulgeOn:', JSON.stringify(bulgeOn), '| bulgeOff:', JSON.stringify(bulgeOff));
  console.log('last:', JSON.stringify(last));
  console.log('seq:', hist.map((h) => (h.armed ? 'A' : '.') + (h.bulged ? 'B' : '.')).join(''));
}
// 机制验证（开阔方向 + 合成投落点 14m）：出膛小 → 臂展 → 临近放大 → 过点缩回
await page.evaluate(() => {
  const m = window.__ppMode();
  m.cameraCtrl.pitch = -0.25;   // 朝天：飞行路径无地形干扰
  m.cameraCtrl.targetPitch = -0.25;
});
await new Promise((r) => setTimeout(r, 300));
const runSynthetic = (D, forceClose) => page.evaluate(({ D, forceClose }) => new Promise((resolve) => {
  const m = window.__ppMode();
  const before = new Set(
    m.entities.allBases().filter((x) => x.entity.kind === 'bullet' && x.isActive).map((x) => x.entity.id),
  );
  m.firePlayerBullet();
  const b = m.entities.allBases().find(
    (x) => x.entity.kind === 'bullet' && x.isActive && !before.has(x.entity.id),
  );
  if (!b) { resolve({ err: 'no fresh bullet' }); return; }
  const v = m.physics.getLinearVelocity(b.entity.rigidBody.handle);
  const L = Math.hypot(v.x, v.y, v.z) || 1;
  const p = b.entity.position;
  b.target = { x: p.x + v.x / L * D, y: p.y + v.y / L * D, z: p.z + v.z / L * D };
  // mirror activate() 的近点判定（真实近点发射时由 activate 计算）
  if (forceClose) b.closeShot = D <= 15;
  const rec = [];
  let n = 0;
  const step = () => {
    const q = b.entity.position;
    const t = b.target;
    rec.push({
      id: b.entity.id, armed: b.armed, bulged: b.bulged, close: b.closeShot, active: b.isActive,
      d: t ? +Math.hypot(t.x - q.x, t.y - q.y, t.z - q.z).toFixed(2) : -1,
    });
    n++;
    if (n < 60 && b.isActive) requestAnimationFrame(step);
    else resolve({ rec });
  };
  requestAnimationFrame(step);
}), { D, forceClose });
// ① 落点 6m（近点小弹）：应全程 close=true、armed=false、bulged=false
const c6 = await runSynthetic(6, true);
console.log('close 6m  — seq:', c6.rec.map((h) => (h.armed ? 'A' : '.') + (h.bulged ? 'B' : '.') + (h.close ? 'C' : '.')).join(''));
console.log('          closeShot all?', c6.rec.every((h) => h.close), '| any arm?', c6.rec.some((h) => h.armed), '| any bulge?', c6.rec.some((h) => h.bulged));
// ② 落点 14m（常规）：应臂展 A、临近放大 B、过点缩回
const c14 = await runSynthetic(14, false);
console.log('normal 14m — seq:', c14.rec.map((h) => (h.armed ? 'A' : '.') + (h.bulged ? 'B' : '.')).join(''));
const bi = c14.rec.findIndex((h) => h.bulged);
const bo = bi >= 0 ? c14.rec.findIndex((h, k) => k > bi && !h.bulged) : -1;
console.log('          bulgeOn@d=', bi >= 0 ? c14.rec[bi].d : 'never', '| bulgeOff@d=', bo >= 0 ? c14.rec[bo].d : 'still/ended');
console.log('pageerrors:', errs.length ? errs : 'none');
await browser.close();