import puppeteer from 'puppeteer-core';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox'] });
const page = await browser.newPage();
const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5175/';
await page.goto(`${RTS_URL}${RTS_URL.includes('?') ? '&' : '?'}seed=4242&x=60&z=-40`, { waitUntil: 'domcontentloaded', timeout: 120000 });
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

// ★ 新引擎（?swarm=new）健全性（重写 P4；G9 调试口契约）
{
  const url = page.url();
  if (url.includes('swarm=new')) {
    const ne = await page.evaluate(() => globalThis.__rts?.newEngine?.() ?? null);
    const okNe = !!ne && ne.ticks > 0 && ne.squads.count > 0 && ne.writer.issued + ne.writer.kept > 0;
    console.log(`新引擎健全性: ${okNe ? 'PASS' : 'FAIL'} ` + (ne ? JSON.stringify({ ticks: ne.ticks, squads: ne.squads.count, writer: ne.writer }) : '(无 newEngine 调试口)'));
    if (!okNe) process.exitCode = 1;
  }
}

await browser.close();
