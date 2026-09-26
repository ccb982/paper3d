// 临时：爬坡脚高记录复查（跑完即删）——脚着地才算爬完；卡地里=脚面差<-0.3
import puppeteer from 'puppeteer-core';

const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5174/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const RUN_S = +(process.env.RUN_S ?? 150);

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${RTS_URL}?seed=4242&x=-17&z=-267`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.swarm, { timeout: 240000, polling: 500 });
await page.evaluate(() => { window.__rts.climbStats.trace.length = 0; });
await new Promise((r) => setTimeout(r, RUN_S * 1000));
const res = await page.evaluate(() => {
  const st = window.__rts.climbStats;
  const tr = st.trace;
  const byPhase = {};
  for (const e of tr) byPhase[e.phase] = (byPhase[e.phase] ?? 0) + 1;
  const done = tr.filter((e) => e.phase === 'landed');
  const worst = [...tr].sort((a, b) => b.buryMax - a.buryMax).slice(0, 6);
  return {
    stats: { sessions: st.core.sessions, landed: st.core.landed, abandoned: st.core.abandoned,
      badStarts: st.core.badStarts, buryFrames: st.core.buryFrames, approach: st.core.approach },
    byPhase,
    landedFootGap: done.map((e) => +e.footGap.toFixed(2)),
    worstBuried: worst.map((e) => `#${e.id} ${e.phase} f=${e.frames} y0=${e.y0.toFixed(1)} top0=${e.top0.toFixed(1)} buryMax=${e.buryMax.toFixed(2)} footGap=${e.footGap.toFixed(2)}`),
    last6: tr.slice(-6).map((e) => `#${e.id} ${e.phase} f=${e.frames} y=${(e.y ?? 0).toFixed(2)} top0=${e.top0.toFixed(2)} buryMax=${e.buryMax.toFixed(2)}`),
  };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
