import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * ★ 训练结果自动落盘中间件（开发服务器）：
 *   训练页（train.html）在每次刷新最优时 POST /api/lumbar-save →
 *   追加写 `data/lumbar/results.json`（历史）+ 覆盖 `data/lumbar/best.json`（最新最优）。
 *   与 CLI `tools/_train-lumbar.ts` 写同一套文件；静态构建（非 dev）下页面自动退回
 *   localStorage + "导出结果 JSON"按钮。
 */
function lumbarAutoSave() {
  return {
    name: 'lumbar-autosave',
    configureServer(server: {
      config: { root: string };
      middlewares: { use: (route: string, fn: (req: any, res: any) => void) => void };
    }) {
      server.middlewares.use('/api/lumbar-save', (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (c: unknown) => { body += String(c); });
        req.on('end', () => {
          try {
            const j = JSON.parse(body || '{}') as Record<string, unknown>;
            const dir = path.resolve(server.config.root, 'data/lumbar');
            fs.mkdirSync(dir, { recursive: true });
            const resultsPath = path.join(dir, 'results.json');
            let hist: unknown[] = [];
            try { hist = JSON.parse(fs.readFileSync(resultsPath, 'utf8')) as unknown[]; } catch { /* 首次 */ }
            const record = { time: new Date().toISOString(), source: 'train.html', ...j };
            hist.push(record);
            fs.writeFileSync(resultsPath, JSON.stringify(hist, null, 2));
            fs.writeFileSync(path.join(dir, 'best.json'), JSON.stringify(record, null, 2));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, count: hist.length }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });
    },
  };
}

// ★ 与 v1 相同的两条硬约束（别删）：
//   1. `vite-plugin-wasm` + `vite-plugin-top-level-await` 是**必需**的 ——
//      @dimforge/rapier3d 包内第一行就是裸的 `import * as wasm from "./rapier_wasm3d_bg.wasm"`，
//      不装插件 Vite 直接崩在 import-analysis。
//   2. `cacheDir: '.vite'` 是**必需**的 —— 本项目的 node_modules 是指向
//      stickman-lab(v1) 的目录 junction，默认缓存位置会与 v1 共用并互相清空。
export default defineConfig({
  plugins: [wasm(), topLevelAwait(), lumbarAutoSave()],
  cacheDir: '.vite',
  server: {
    port: 5274,
    open: false,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    // ★ 两个页面：主页面 + 腰椎策略训练台（训练结果经 localStorage 自动给主页面用）
    rollupOptions: {
      input: { main: 'index.html', train: 'train.html' },
    },
  },
});
