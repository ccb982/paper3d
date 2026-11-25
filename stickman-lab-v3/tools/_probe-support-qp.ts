import { solveSupportQp } from '../src/core/servo/supportQp';

const cases = [
  {
    name: 'symmetric',
    input: {
      mass: 70, gravity: 9.81, comX: 0, comY: 0.6, aX: 0, aY: 0, lDotZ: 0,
      feet: [
        { active: true, x: 0.1, y: 0.08, halfX: 0.08, fzRef: 343, copXRef: 0.1, fzMax: 1000, mu: 0.7 },
        { active: true, x: -0.1, y: 0.08, halfX: 0.08, fzRef: 343, copXRef: -0.1, fzMax: 1000, mu: 0.7 },
      ],
    },
  },
  {
    name: 'comX=0.05',
    input: {
      mass: 70, gravity: 9.81, comX: 0.05, comY: 0.6, aX: 0, aY: 0, lDotZ: 0,
      feet: [
        { active: true, x: 0.1, y: 0.08, halfX: 0.08, fzRef: 343, copXRef: 0.1, fzMax: 1000, mu: 0.7 },
        { active: true, x: -0.1, y: 0.08, halfX: 0.08, fzRef: 343, copXRef: -0.1, fzMax: 1000, mu: 0.7 },
      ],
    },
  },
  {
    name: 'single-foot',
    input: {
      mass: 70, gravity: 9.81, comX: 0.1, comY: 0.6, aX: 0, aY: 0, lDotZ: 0,
      feet: [
        { active: true, x: 0.1, y: 0.08, halfX: 0.08, fzRef: 687, copXRef: 0.1, fzMax: 1000, mu: 0.7 },
        { active: false, x: -0.1, y: 0.08, halfX: 0.08, fzRef: 0, copXRef: -0.1, fzMax: 0, mu: 0.7 },
      ],
    },
  },
  {
    name: 'infeasible',
    input: {
      mass: 70, gravity: 9.81, comX: 0, comY: 0.6, aX: 0, aY: 0, lDotZ: 0,
      feet: [
        { active: true, x: 0.1, y: 0.08, halfX: 0.08, fzRef: 343, copXRef: 0.1, fzMax: 100, mu: 0.7 },
        { active: true, x: -0.1, y: 0.08, halfX: 0.08, fzRef: 343, copXRef: -0.1, fzMax: 100, mu: 0.7 },
      ],
    },
  },
];

for (const c of cases) {
  const out = solveSupportQp(c.input);
  console.log(c.name, {
    feasible: out.feasible,
    fz: out.fz.map((v) => +v.toFixed(3)),
    fx: out.fx.map((v) => +v.toFixed(3)),
    tauZ: out.tauZ.map((v) => +v.toFixed(3)),
    copX: out.copX.map((v) => +v.toFixed(4)),
    totalFz: +out.totalFz.toFixed(3),
    totalFx: +out.totalFx.toFixed(3),
    totalMz: +out.totalMz.toFixed(3),
  });
}
