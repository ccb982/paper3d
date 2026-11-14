// ============================================================
// black-probe —— 进场黑屏计时
//   在 __ppEnterWorld() 调用前后注入 rAF 帧标记 + longtask 观察器：
//     · frames[0] = 从调用到第一帧的时间（≈ 黑屏时长）
//     · longTasks = 期间所有 >50ms 的主线程长任务
//   用法：node scripts/black-probe.mjs
// ============================================================
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Users\\22641\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.PROBE_URL || 'http://localhost:5173/?perf=1&wipe=1&seed=1679464028';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  protocolTimeout: 600000,
  defaultViewport: { width: 1600, height: 900 },
  args: ['--window-size=1600,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (/错误|Error|Failed|失败/.test(t)) console.log(`[page:${m.type()}]`, t);
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__ppEnterWorld === 'function', {
  timeout: 120000,
  polling: 200,
});
// 等 boot 的资产加载（主角/子弹/敌人 FTX）全部完成再做，避免把 boot 解码算进进场
await new Promise((r) => setTimeout(r, 12000));

// ★ CDP CPU Profiler：直接抓 __ppEnterWorld() 这 652ms 的函数级热点
const client = await page.createCDPSession();
await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 100 });
await client.send('Profiler.start');
await page.evaluate(() => { window.__ppEnterWorld(); });
const { profile } = await client.send('Profiler.stop');
await client.send('Profiler.disable');

console.log('\n===== enterWorld CPU 热点（self samples 降序）=====');
{
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const counts = new Map();
  for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
  const rows = [];
  for (const [id, c] of counts) {
    const n = byId.get(id);
    if (!n) continue;
    const cf = n.callFrame;
    const file = (cf.url || '').split('/').pop() || '(native)';
    rows.push({ n: c, fn: cf.functionName || '(anon)', at: `${file}:${cf.lineNumber + 1}` });
  }
  // 同名函数合并（不同调用点）
  const merged = new Map();
  for (const r of rows) {
    const k = `${r.fn} ${r.at}`;
    merged.set(k, (merged.get(k) || 0) + r.n);
  }
  const top = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const total = (profile.samples || []).length || 1;
  for (const [k, c] of top) {
    console.log(`${String(c).padStart(5)}  ${(c / total * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
  console.log(`(总样本 ${total})`);
}

const res = await page.evaluate(() => ({
  longTasks: window.__ppLongTasks || [],
  cost: window.__ppEnterCost || null,
}));

console.log('\n===== enterCost =====');
console.log(JSON.stringify(res.cost));

console.log('\n===== 进场期长任务（>50ms，前 10）=====');
console.log(JSON.stringify([...res.longTasks].sort((a, b) => b.d - a.d).slice(0, 10)));

await browser.close();
