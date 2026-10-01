// 3D 验证截图：冻结在初始站姿，从多个机位拍 —— 用来证明"护甲板贴在刚体上"而不是贴在屏幕上
// 跑法：node .tmp/shot3d.mjs [url]
import puppeteer from 'puppeteer-core';
import path from 'node:path';

const URL_ = process.argv[2] || 'http://localhost:5273/';
const CHROME = 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1400,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`[console.error] ${m.text()}`); });

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => !!window.STICKMAN, { timeout: 30000 });

// 冻结 + 摆回初始姿态：零基因组 = 关节目标速度为 0（配合被动姿态张力就站得住）
const info = await page.evaluate(() => {
  const S = window.STICKMAN;
  S.state.paused = true;
  S.showcase.begin(new Float32Array(S.trainer.paramCount));
  return {
    params: S.trainer.paramCount,
    joints: S.skeleton.joints.length,
    bodies: S.skeleton.bodies.length,
    camAz: S.viewer.camAz, camEl: S.viewer.camEl, camDist: S.viewer.camDist,
  };
});
console.log('页面状态:', JSON.stringify(info));

const shots = [
  ['front34', 0, 0],        // 默认 3/4 前视（先 resetView 回到默认 camAz=0.72）
  ['side', 1.25, -0.15],    // 再转 72° 到侧面：这时才看得出护甲板是真的贴在刚体上
  ['top34', -0.55, 0.65],   // 俯视 3/4
];
for (const [name, dAz, dEl] of shots) {
  await page.evaluate((a, e) => {
    const v = window.STICKMAN.viewer;
    v.resetView();       // 每张都从默认机位起步，避免叠加
    v.orbit(a, e);
  }, dAz, dEl);
  await new Promise((r) => setTimeout(r, 700));
  const out = path.resolve(`.tmp/shot3d-${name}.png`);
  await page.screenshot({ path: out });
  console.log('  截图', out, 'az=' + (dAz + 0.72).toFixed(2));
}

// 再来一张"真在跑"的（取消暂停，看 3D 动态）
await page.evaluate(() => { window.STICKMAN.state.paused = false; });
await new Promise((r) => setTimeout(r, 1800));
await page.screenshot({ path: path.resolve('.tmp/shot3d-running.png') });
console.log('  截图 .tmp/shot3d-running.png');

console.log('错误:', errs.length ? errs.join('\n  ') : '（无）');
await browser.close();
