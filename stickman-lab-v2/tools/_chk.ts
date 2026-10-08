import './_boot';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const sk = buildSkeleton({ ...DEFAULT_CONFIG });
let total = 0;
for (const b of sk.bodies) {
  const m = b.colliders.reduce((s, c) => s + c.mass, 0);
  total += m;
  const cs = b.colliders.map((c) => {
    const dim = c.shape === 'capsule'
      ? `r=${c.radius} hh=${c.halfHeight}`
      : `hx=${c.hx} hy=${c.hy} hz=${c.hz}`;
    return `${c.shape}[${dim}] m=${c.mass}`;
  }).join(' | ');
  console.log(`${b.key.padEnd(9)} y=${b.cy.toFixed(4)}  ${cs}`);
}
console.log('总质量 =', total.toFixed(4));
