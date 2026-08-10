import { build } from 'esbuild';
import { writeFileSync } from 'fs';

// 打包 forcedFixBrush 相关模块（把 ftxCore 也打进 bundle）
const result = await build({
  entryPoints: ['C:/Users/22641/Desktop/架构重置/另起的绘画网页/src/utils/colorCompressor.ts'],
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'node',
  // colorCompressor 依赖：regionDetection(may use DOM), multiFrameExport, useAppStore(react)
  // 这些会打爆 bundle。改用 tree-shake 不可行。
  // 直接只打包 forcedFixBrush 依赖的核心：用 external 排除无关
});
console.log('bundle 大小:', result.outputFiles[0].contents.length);
// 但 useAppStore/react 依赖会导致 node 运行失败
// 方案：单独提取 forcedFixBrush 逻辑到临时文件测试
