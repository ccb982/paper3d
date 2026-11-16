import './_boot';
import { World } from '../src/core/world';
const w = new World();
const m = (w.body as any).sk.massTotal;
console.log('massTotal =', m.toFixed(1), 'kg');
const tmax: Array<[string, number]> = [
  ['hip/0 (380×0.6)', 380 * 0.6], ['hip/2 (380)', 380], ['knee', 300], ['ankle(cfg.ankleTorque)', 120],
  ['spine lateral (260×0.6)', 260 * 0.6], ['spine sagittal (260)', 260],
];
for (const [n, t] of tmax) console.log(n.padEnd(24), t.toFixed(0).padStart(5), 'N·m =', (t / m).toFixed(2), 'N·m/kg');
console.log('--- 文献对照: 髇外展 1.82(男)/1.45(女) | 膝伸~小时 2.5-3.0 | 踝跖屈 1.5-2.0 | 单腿站髇外展外力矩 0.8-1.5');
