import { solveRightingMpc } from '../src/core/servo/rightingMpc';

const A = [
  [0.97641, -0.23137, 0.01574, -0.01914],
  [0.00421, 1.01930, 0.00037, 0.00322],
  [0.00266, 0.02686, 0.99803, 0.00066],
  [0.00267, 0.03040, -0.01734, 0.98718],
];
const B = [
  [-0.00168, -0.00020, -0.00076],
  [-0.01799, -0.00257, -0.00731],
  [0.00052, 0.00088, 0.00234],
  [0.00218, 0.00117, -0.00145],
];
let x = [5, 0, 2, 1];
const buf: number[][] = Array.from({ length: 11 }, () => [0, 0, 0]);
let lastU = [0, 0, 0];
for (let k = 0; k < 2400; k++) {
  if (k % 5 === 0) {
    const o = solveRightingMpc({ e: x[0]!, v: x[1]!, trunkZ: x[2]!, trunkR: x[3]!, uaCap: 200, uhCap: 200, ubCap: 100, delay: 11, horizon: 20 });
    lastU = [o.ua, o.uh, o.ub];
  }
  buf.push(lastU); const u = buf.shift()!;
  const nx = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    nx[i] = A[i]![0]! * x[0]! + A[i]![1]! * x[1]! + A[i]![2]! * x[2]! + A[i]![3]! * x[3]! + B[i]![0]! * u[0]! + B[i]![1]! * u[1]! + B[i]![2]! * u[2]!;
  }
  x = nx;
  if (k % 240 === 0) console.log(k, x.map((v) => v.toFixed(2)).join(','));
}
