// 用本机 Chrome + puppeteer-core 打开页面，抓控制台/网络错误并截图
// 跑法：node .tmp/shot.mjs [url] [等待毫秒]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const URL_ = process.argv[2] || 'http://localhost:5273/';
const WAIT = Number(process.argv[3] || 4000);
const CLICK = process.argv[4] || '';
const AFTER = Number(process.argv[5] || 2500);
const CHROME = 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(`.tmp/shot${process.argv[6] ? '-' + process.argv[6] : ''}.png`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1400,900',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });

const logs = [];
page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`);
});

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, WAIT));

if (CLICK) {
  await page.click(CLICK);
  await new Promise((r) => setTimeout(r, AFTER));
}

// 抓页面关键状态
const probe = await page.evaluate(() => {
  const g = (id) => {
    const el = document.getElementById(id);
    return el ? (el.textContent || '').trim().slice(0, 160) : '(缺元素)';
  };
  const view = document.getElementById('view');
  const vr = view ? view.getBoundingClientRect() : null;
  const cs = view ? getComputedStyle(view) : null;
  const st = document.getElementById('stats');
  const ct = document.getElementById('ctrl');
  const spr = st ? st.getBoundingClientRect() : null;
  return {
    hasStickman: typeof window.STICKMAN !== 'undefined',
    boot: g('boot'),
    stage: g('s-stage'),
    gen: g('s-gen'),
    tps: g('s-tps'),
    bodyChildren: document.body.children.length,
    viewCss: vr ? `${Math.round(vr.width)}x${Math.round(vr.height)} @(${Math.round(vr.left)},${Math.round(vr.top)})` : '(无 #view)',
    viewAttr: view ? `${view.width}x${view.height}` : '-',
    viewStyle: cs ? `display=${cs.display} pos=${cs.position} visibility=${cs.visibility} opacity=${cs.opacity} zIndex=${cs.zIndex}` : '-',
    statsBox: spr ? `${Math.round(spr.width)}x${Math.round(spr.height)} @(${Math.round(spr.left)},${Math.round(spr.top)})` : '(无 #stats)',
    ctrlExists: !!ct,
    docSize: `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
  };
});

console.log('=== 页面状态 ===');
for (const [k, v] of Object.entries(probe)) console.log(`  ${k}: ${v}`);

console.log('\n=== 控制台 / 错误（最多 60 条）===');
if (!logs.length) console.log('  （无）');
for (const l of logs.slice(0, 60)) console.log('  ' + l);

await page.screenshot({ path: OUT, fullPage: false });
console.log(`\n截图：${OUT}`);

const viewEl = await page.$('#view');
if (viewEl) {
  const OUTV = path.resolve('.tmp/shot-view.png');
  await viewEl.screenshot({ path: OUTV });
  console.log(`画布截图：${OUTV}`);
}

await browser.close();
