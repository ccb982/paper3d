/**
 * diag-purity.ts —— buildSkeleton 是否是纯函数？
 * 用法：node tools/run.mjs diag-purity
 */
import './_boot';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const snap = (sk: ReturnType<typeof buildSkeleton>) =>
  sk.bodies.map((b) => `${b.key}:${b.cx.toFixed(6)},${b.cy.toFixed(6)},${b.cz.toFixed(6)}`).join('|');

const a = buildSkeleton(DEFAULT_CONFIG);
const b = buildSkeleton(DEFAULT_CONFIG);
const c = buildSkeleton(DEFAULT_CONFIG);

console.log('════ buildSkeleton 纯函数性 ════');
console.log(`第1次 vs 第2次 ${snap(a) === snap(b) ? '✔ 一致' : '✘ 不一致'}`);
console.log(`第2次 vs 第3次 ${snap(b) === snap(c) ? '✔ 一致' : '✘ 不一致'}`);

if (snap(a) !== snap(b)) {
  console.log('\n逐刚体差异：');
  a.bodies.forEach((ab, i) => {
    const bb = b.bodies[i]!;
    if (ab.cx !== bb.cx || ab.cy !== bb.cy || ab.cz !== bb.cz) {
      console.log(`  ${ab.key.padEnd(10)} 1st=(${ab.cx.toFixed(6)}, ${ab.cy.toFixed(6)}, ${ab.cz.toFixed(6)})  2nd=(${bb.cx.toFixed(6)}, ${bb.cy.toFixed(6)}, ${bb.cz.toFixed(6)})`);
    }
  });
  console.log('\n质量差异：');
  a.bodies.forEach((ab, i) => {
    const bb = b.bodies[i]!;
    if (Math.abs(ab.mass - bb.mass) > 1e-9) {
      console.log(`  ${ab.key.padEnd(10)} 1st=${ab.mass}  2nd=${bb.mass}`);
    }
  });
  console.log('\n关节差异：');
  a.joints.forEach((aj, i) => {
    const bj = b.joints[i]!;
    if (JSON.stringify(aj.parentLocal) !== JSON.stringify(bj.parentLocal)
      || JSON.stringify(aj.childLocal) !== JSON.stringify(bj.childLocal)) {
      console.log(`  ${aj.name.padEnd(12)} 1st P=${JSON.stringify(aj.parentLocal)} C=${JSON.stringify(aj.childLocal)}`);
      console.log(`  ${''.padEnd(12)} 2nd P=${JSON.stringify(bj.parentLocal)} C=${JSON.stringify(bj.childLocal)}`);
    }
  });
}

console.log('');
const total = a.bodies.reduce((s, x) => s + x.mass, 0);
const total2 = b.bodies.reduce((s, x) => s + x.mass, 0);
console.log(`总质量 1st=${total.toFixed(6)}  2nd=${total2.toFixed(6)}  差=${(total2 - total).toExponential(3)}`);
