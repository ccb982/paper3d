import { buildSync } from 'esbuild';
buildSync({ entryPoints: ['test_mp_entry.ts'], bundle: true, outfile: 'test_mp.cjs', format: 'cjs', platform: 'node', logLevel: 'error' });
console.log('bundled');
