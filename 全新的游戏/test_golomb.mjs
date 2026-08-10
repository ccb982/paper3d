import { buildSync } from 'esbuild';
buildSync({
  entryPoints: ['test_golomb_entry.ts'],
  bundle: true, outfile: 'test_golomb_bundle.cjs', format: 'cjs', platform: 'node', logLevel: 'error',
});
console.log('bundled');
