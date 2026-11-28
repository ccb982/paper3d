import './_boot';
import { solveContactIdQp } from '../src/core/servo/contactIdQp';

const M = [[1, 0], [0, 1]];
const g = [0, -9.81];
const qdd = [0, 0];
const J = [[0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0]];
const out = solveContactIdQp({
  massMatrix: M,
  gravity: g,
  qddTarget: qdd,
  contacts: [{ jacobian: J, halfX: 0.1, halfZ: 0.05, mu: 0.7, fzMin: 0, wrenchRef: [0, 9.81, 0, 0, 0, 0] }],
  torqueMax: [0, 0],
});
console.log(JSON.stringify(out, null, 2));
