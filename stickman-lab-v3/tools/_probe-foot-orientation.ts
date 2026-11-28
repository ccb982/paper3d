import './_boot';
import { planFootOrientationTask } from '../src/core/servo/footOrientationTask';
const q = { x: 0.1, y: 0.05, z: 0.02, w: 0.993 };
console.log(JSON.stringify(planFootOrientationTask({ actualQ: q, targetQ: { x: 0, y: 0, z: 0, w: 1 }, angVel: { x: 0.2, y: 0, z: -0.1 }, kp: 100, kd: 10, accMax: 20 }), null, 2));
