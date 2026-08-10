import { build } from 'esbuild';
import { writeFileSync } from 'fs';
const result = await build({
  entryPoints: ['C:/Users/22641/Desktop/架构重置/另起的绘画网页/src/utils/colorCompressor.ts'],
  bundle: true, format: 'cjs', write: false, platform: 'node', logLevel: 'silent',
});
writeFileSync('C:/Users/22641/Desktop/架构重置/另起的绘画网页/_fix_bundle.cjs', result.outputFiles[0].contents);
console.log('ok');
