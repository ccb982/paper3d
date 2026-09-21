// 地形取证：采样出生列队一带 blockedAt / 深度 / 角色 —— 查"工程兵困在原地"是否地形硬边界所致
import puppeteer from 'puppeteer-core';
const SEED = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 4242;
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({
  meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} },
});
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(SEED));
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&swarmtrace=1&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__commander', { timeout: 120000 });
await page.evaluate((s, st) => window.__ppRun(s, st), 30, 0.5);
const perr = await page.evaluate(() => ({
  err: typeof window.__ppLastError === 'function' ? window.__ppLastError() : 'no hook',
  time: typeof window.__ppTime === 'function' ? window.__ppTime() : 'no hook',
}));
console.log('__ppLastError:', perr.err);
const res = await page.evaluate(() => {
  const c = window.__commander;
  const ts = c.terrainScore;
  const raster = window.__ppMode().raster;
  const out = { blockedAd: {} };
  const grid = [];
  for (let z = 640; z <= 700; z += 2) {
    let row = [];
    for (let x = 430; x <= 500; x += 2) {
      const b = ts.blockedAt(x, z);
      row.push(b ? '#' : '.');
    }
    grid.push(row.join(''));
  }
  const spots = [[455, 685], [470, 684], [480, 682], [485, 680], [472, 683], [463, 688], [454, 694], [485, 620], [437, 617]];
  const detail = spots.map(([x, z]) => {
    const td = raster.tileDefAt(x, z);
    return { x, z, blocked: ts.blockedAt(x, z), role: td.genRole, depth: +raster.levelDepthAt(x, z).toFixed(2), surf: +raster.surfaceHeightAt(x, z).toFixed(2) };
  });
  const covered = c.builtSlots.size;
  const pieces = c.buildPieces.map((q) => ({ x: q.x, z: q.z, kind: q.kind, ring: q.ring }));
  return { grid, detail, covered, pieces, players: { px: window.__ppMode().player.position.x, pz: window.__ppMode().player.position.z } };
});
console.log('blockedAt 地图(z640..700↓, x430..500→): #=blocked');
for (const l of res.grid) console.log('  ' + l);
console.log('\n关键点:'); res.detail.forEach((d) => console.log(`  (${d.x},${d.z}) blocked=${d.blocked ? '是' : '否'} role=${d.role} 深度=${d.depth}m 面高=${d.surf}m`));
console.log('\n已建=' + res.covered + ' 玩家=(' + res.players.px + ',' + res.players.pz + ')');
console.log('buildPieces 前 20:', JSON.stringify(res.pieces.slice(0, 20)));
await browser.close();