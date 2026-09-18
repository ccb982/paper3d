// cwd 包装：bash 在本机损坏（cd/dirname 全 not found）→ 用 node 自己 chdir。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
process.chdir(root);
console.log('[cwd]', process.cwd());

const node = process.execPath;

// ① tsc --noEmit
const tsc = spawnSync(node, [
  path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json',
], { cwd: root, encoding: 'utf8', stdio: 'inherit' });
console.log('--- tsc exit =', tsc.status);

// ② arch-guard
const guard = spawnSync(node, ['scripts/arch-guard.mjs'], {
  cwd: root, encoding: 'utf8',
});
console.log('--- arch-guard exit =', guard.status);
process.stdout.write(guard.stdout ?? '');
process.stderr.write(guard.stderr ?? '');
