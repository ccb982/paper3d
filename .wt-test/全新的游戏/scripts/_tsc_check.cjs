// 类型检查（输出 UTF-8 文件，供 Read 读取）
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = 'C:\\Users\\22641\\Desktop\\架构重置\\全新的游戏';
const tscJs = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

let out = '';
try {
  const r = execFileSync(process.execPath, [tscJs, '--noEmit', '-p', 'tsconfig.json'], {
    cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  out = 'TSC_OK\n' + (r || '');
} catch (e) {
  out = 'TSC_FAIL\n' + (e.stdout || '') + '\n--- stderr ---\n' + (e.stderr || '');
}
fs.writeFileSync(path.join(root, '_tsc_out.txt'), out, 'utf8');
console.log('done');
