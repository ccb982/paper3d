import puppeteer from 'puppeteer-core';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://localhost:5175/?seed=4242&x=60&z=-40', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.swarm, { timeout: 240000, polling: 500 });
console.log('[装载] 观察 30s…');
const seen = [];
for (let i = 0; i < 30; i += 3) {
  await new Promise(r => setTimeout(r, 3000));
  const s = await page.evaluate(() => {
    const c = window.__rts.swarm.commander; const lg = c.swarm.cmdLog;
    const uniq = lg.recent(400).filter((e) => e.n === 1);
    const per = new Map(); for (const e of uniq) per.set(e.squadId, (per.get(e.squadId) ?? 0) + 1);
    const top = [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `#${k}:${v}`);
    return { kept: c.stableDbg.kept, uniqN: lg.unique, last: c.stableDbg.last, top: top.join(' '), spread: c.spreadDbg?.n ?? null };
  });
  seen.push(`[${i + 3}s] kept=${s.kept} 散开=${s.spread} 累计唯一令=${s.uniqN} | 最近被拦: ${s.last}`);
}
console.log(seen.join('\n'));
await browser.close();
