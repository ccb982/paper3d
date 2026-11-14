// 粗块诊断：进基地 → 出击（走 onDepart 预创建）→ 读粗块覆盖
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
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), mk());
await page.goto('http://localhost:5173/?perf=1', { waitUntil: 'domcontentloaded' });
await page.bringToFront();
await page.waitForFunction('!!window.__ppCoarse', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

console.log('基地中:', JSON.stringify(await page.evaluate(() => window.__ppCoarse())));
await page.evaluate(() => window.__game.enterBase());
await new Promise((r) => setTimeout(r, 3000));
console.log('进基地后:', JSON.stringify(await page.evaluate(() => window.__ppCoarse())));

// 出击（走 onDepart → 预创建 → enterWorldMode）
await page.evaluate(() => window.__ppMode().doDepart());
await new Promise((r) => setTimeout(r, 3000));
console.log('出击后 3s:', JSON.stringify(await page.evaluate(() => window.__ppCoarse())));
await new Promise((r) => setTimeout(r, 6000));
console.log('出击后 9s:', JSON.stringify(await page.evaluate(() => window.__ppCoarse())));
await browser.close();
