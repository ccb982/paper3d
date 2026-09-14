import puppeteer from 'puppeteer-core';
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const player = grid(4, 6);
const session = {
  meta: { version: '0.2.0', day: 1, seed: 4242, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 1e6, maxHp: 1e6, attackPower: 4000, defense: 900, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: grid(30, 30), ship: grid(8, 10), player },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false },
  outOfRun: { owned: {} },
  story: { flags: {}, events: {} },
};
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-throttling', '--disable-frame-rate-limit'],
});
const page = await browser.newPage();
page.setDefaultTimeout(30000);
await page.setViewport({ width: 1280, height: 800 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message ?? e)));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), session);
await page.goto('http://localhost:5199/?perf=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 6000));
await page.evaluate(() => window.__ppMode().finishDock());
await new Promise((r) => setTimeout(r, 12000));
const probe = await page.evaluate(async () => {
  const A = await import('/src/modes/WorldMode');
  const B = await import('/src/modes/WorldMode.ts');
  const m = window.__ppMode();
  const fpsProbe = await new Promise((res) => { let c = 0; const t0 = performance.now(); const f = () => { c++; if (performance.now() - t0 >= 2000) res((performance.now() - t0) / c); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  return {
    sameObj: A.worldPerf === B.worldPerf,
    wpTs_total: B.worldPerf ? B.worldPerf.total : 'no-wp',
    wpTs_chunks: B.worldPerf ? B.worldPerf.chunks : 'no-wp',
    ctor: m?.constructor?.name,
    phase: m?.phase,
    rAFms: fpsProbe,
    fpsHud: document.body.innerText.match(/([\d.]+) FPS/)?.[1],
  };
});
console.log(JSON.stringify(probe, null, 2));
console.log('errs:', errs.join(' | ') || '(none)');
await browser.close();