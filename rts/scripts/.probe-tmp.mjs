// 临时：T+120s 全队快照（跑完即删）
import puppeteer from 'puppeteer-core';

const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5174/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 9e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${RTS_URL}?seed=4242&x=-17&z=-267`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.shadowBridge?.engineer, { timeout: 240000, polling: 500 });
await page.evaluate(() => { window.__setSpeed(20); });
const res = await page.evaluate(async () => {
  const w = window.__rts;
  // 等到模拟时间 ≥120s
  await new Promise((res2) => {
    const iv = setInterval(() => { if (w.simT >= 120) { clearInterval(iv); res2(); } }, 200);
  });
  const sb = w.shadowBridge;
  const ship = { x: -17, z: -267 };
  const eng = [...sb.squads.all()].filter((r) => r.role === 'engineer');
  const rows = [];
  for (const r of sb.squads.all()) {
    const y = w.swarm.data.lastShipX !== undefined ? undefined : undefined;
    const o = sb.writer.store.get(r.id)?.order;
    const dEng = eng.length ? Math.min(...eng.map((e) => Math.hypot(e.x - r.x, e.z - r.z))) : -1;
    const isPlateau = r.z <= -242;   // 标准图：z≤-242 高原（y≈6）
    rows.push(`#${r.id}${r.role[0]}(${r.alive}) @${r.x.toFixed(0)},${r.z.toFixed(0)}${isPlateau ? '[高原]' : ''} dShip=${Math.hypot(r.x - ship.x, r.z - ship.z).toFixed(0)} still=${r.stillS.toFixed(0)} o=${o ? o.kind : '-'} oa=${o ? `(${(o.target.x).toFixed(0)},${(o.target.z).toFixed(0)})` : '-'} dEng=${dEng.toFixed(0)}`);
  }
  const plateau = rows.filter((s) => s.includes('[高原]')).length;
  return { simT: +w.simT.toFixed(0), rows, plateau, shipY: w.raster.surfaceHeightAt(ship.x, ship.z),
    ring: [sb.dbg.ringMin, sb.dbg.ringMax], main: w.tactics.mainSectors };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
