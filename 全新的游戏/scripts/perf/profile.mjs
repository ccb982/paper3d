// 采集 CDP 采样 CPU Profile（headful）→ 定位 ~46ms 卡顿归属的调用栈
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const player = grid(4, 6);
const mk = (hp) => ({
  meta: { version: '0.2.0', day: 1, seed: 4242, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp, maxHp: hp, attackPower: 4000, defense: 900, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: grid(30, 30), ship: grid(8, 10), player },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false },
  outOfRun: { owned: {} },
  story: { flags: {}, events: {} },
});

async function one(name, session, url, holdMs) {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1280,800'],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), session);
  const sep = url.includes('?') ? '&' : '?';
  await page.goto(`http://localhost:5199/?perf=1${sep}${url.replace(/^\?/, '')}`, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 2200));
  await page.evaluate(() => window.__ppEnterWorld());
  await new Promise((r) => setTimeout(r, 5500));
  await page.evaluate(() => window.__ppMode().finishDock());
  await new Promise((r) => setTimeout(r, 16000));
  const cdp = await page.target().createCDPSession();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  await page.keyboard.down('w');
  await new Promise((r) => setTimeout(r, holdMs));
  await page.keyboard.up('w');
  const { profile } = await cdp.send('Profiler.stop');
  await browser.close();
  fs.writeFileSync(`scripts/perf/data/${name}.cpuprofile`, JSON.stringify(profile));
  console.log(`${name}: profile saved, nodes=${profile.nodes.length}, samples=${profile.samples.length}, durationMs=${profile.endTime - profile.startTime}`);
}

await one('run', mk(100), '', 8000);
await one('cbt150', mk(1e6), '?enemies=150', 8000);
console.log('DONE');