// 临时：强令敌登上高原（低地12敌→船；数 y>5 到达/卡死）（跑完即删）
import puppeteer from 'puppeteer-core';

const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5174/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const SEED = Number(process.env.SEED ?? 4242);
const X = process.env.PX ?? '-17', Z = process.env.PZ ?? '-267';

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${RTS_URL}?seed=${SEED}&x=${X}&z=${Z}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await new Promise((r) => setTimeout(r, 8000));

const placed = await page.evaluate(() => {
  const w = window.__rts;
  let n = 0;
  for (const [lx, lz] of [[0, -232], [-10, -230], [10, -230], [-6, -235], [6, -235], [0, -236]]) {
    for (let k = 0; k < 3; k++) if (w.placeEnemyAt(lx + (k % 2) * 2 - 1, lz + Math.floor(k / 2) * 2 - 1)) n++;
  }
  const issued = w.shadowBridge?.playerOrderNear('march', { x: -17, z: -267 }, 300) ?? 0;
  return { n, issued };
});
console.log('placed/issued=', JSON.stringify(placed));

await page.evaluate(() => {
  window.__up = [];
  setInterval(() => {
    const w = window.__rts;
    for (const e of (w.enemies ?? [])) {
      let a = window.__up.find((q) => q.uid === e.swarmUid);
      if (!a) { a = { uid: e.swarmUid, ymax: -Infinity, x0: e.entity.position.x, z0: e.entity.position.z }; window.__up.push(a); }
      a.ymax = Math.max(a.ymax, e.entity.position.y);
      a.x = e.entity.position.x; a.z = e.entity.position.z; a.y = e.entity.position.y;
    }
  }, 500);
});
await new Promise((r) => setTimeout(r, 45000));
const res = await page.evaluate(() => {
  const w = window.__rts;
  const alive = new Set((w.enemies ?? []).map((e) => e.swarmUid));
  const out = window.__up.map((a) => ({ uid: a.uid, ymax: +a.ymax.toFixed(1), now: alive.has(a.uid) ? `${a.x | 0},${a.z | 0},y${a.y.toFixed(1)}` : 'gone', d: alive.has(a.uid) ? +Math.hypot(a.x + 17, a.z + 267).toFixed(1) : null }));
  const up = out.filter((q) => q.ymax > 5).length;
  const gone = out.filter((q) => q.now === 'gone').length;
  return { n: out.length, climbed: up, gone, sample: out.slice(0, 12) };
});
console.log('结果:', JSON.stringify(res, null, 1));
await browser.close();
