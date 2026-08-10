import { buildSync } from 'esbuild';
buildSync({
  entryPoints: ['test_readnames_entry.ts'],
  bundle: true, outfile: 'test_readnames_bundle.cjs', format: 'cjs', platform: 'node', logLevel: 'error',
});
console.log('bundled');
