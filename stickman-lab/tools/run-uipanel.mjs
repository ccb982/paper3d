// 面板测试需要 jsdom（只装在 .tmp/node_modules，不污染 junction 指向的本体项目）
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dep = join(here, '..', '.tmp', 'node_modules', 'jsdom');
if (!existsSync(dep)) {
  console.error('[uipanel] 缺 jsdom。装到 .tmp/ 下（不要装进 junction 指向的本体项目）：');
  console.error('  mkdir -p .tmp && cd .tmp && npm init -y && npm i jsdom');
  process.exit(1);
}
const r = spawnSync(process.execPath, [join(here, 'run.mjs'), 'probe-uipanel'], {
  stdio: 'inherit',
  env: { ...process.env, PROBE_EXTERNAL: 'jsdom' },
});
process.exit(r.status ?? 1);
