import { solveSupportQp } from '../src/core/servo/supportQp';

const input = {
  mass: 70, gravity: 9.81, comX: 0.02, comY: 0.6, aX: 0, aY: 0.5, lDotZ: 0,
  feet: [
    { active: true, x: 0.1, y: 0.08, halfX: 0.08, fzRef: 350, copXRef: 0.02, fzMax: 1000, mu: 0.7 },
    { active: true, x: -0.1, y: 0.08, halfX: 0.08, fzRef: 350, copXRef: 0.02, fzMax: 1000, mu: 0.7 },
  ] as const,
  prevFz: [350, 350] as [number, number],
  weights: { fz: 1, fx: 0.2, tau: 0.01, rate: 0.02 },
};

for (let i = 0; i < 200; i++) solveSupportQp(input);
const n = 5000;
const t0 = performance.now();
for (let i = 0; i < n; i++) solveSupportQp(input);
const dt = performance.now() - t0;
console.log(`calls=${n} total=${dt.toFixed(1)}ms per=${(dt / n).toFixed(4)}ms budget60=${(dt / n).toFixed(3)}ms`);
