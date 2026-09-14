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
  defaultViewport: { width: 1024, height: 640 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1024,640'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('[page] ' + String(e.message ?? e)));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), mk());
await page.goto('http://localhost:5199/?perf=1', { waitUntil: 'domcontentloaded' });
await page.bringToFront();
await new Promise((r) => setTimeout(r, 9000));
const promptOf = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find((d) => d.textContent?.startsWith('F ·') || d.textContent === 'F');
  return el ? { text: el.textContent, display: el.style.display } : { err: 'no prompt el' };
});
// 需要 BaseScene 实例：BaseMode → m.baseScene
const pos = (x, z) => page.evaluate(({ x, z }) => {
  const m = window.__ppMode();
  const bs = m.baseScene;
  bs.charPos.x = x; bs.charPos.z = z;
}, { x, z });
const craftX = await page.evaluate(() => window.__ppMode().baseScene.craftBayX);
console.log('craftBayX =', craftX);
for (const [x, z, tag] of [
  [0, 0, '仓库中央'],
  [craftX, 0, '加工站房间中线'],
  [craftX, -5, '工作台前'],
  [craftX + 10, -5, '加工站房间远侧'],
]) {
  await pos(x, z);
  await new Promise((r) => setTimeout(r, 400));
  console.log(tag, '→', JSON.stringify(await promptOf()));
}
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
