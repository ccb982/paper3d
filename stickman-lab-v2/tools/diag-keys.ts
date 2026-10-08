/**
 * diag-keys.ts —— 列出刚体 key 与关节父子 key 的存在性校验
 * 用法：node tools/run.mjs diag-keys
 */
import './_boot';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
console.log(`bodies(${sk.bodies.length}):`);
console.log(sk.bodies.map((b, i) => `${i}:${b.key}`).join('  '));
console.log('');
console.log(`joints(${sk.joints.length}):`);
let bad = 0;
sk.joints.forEach((j, i) => {
  const hasP = sk.bodies.some((b) => b.key === j.parentKey);
  const hasC = sk.bodies.some((b) => b.key === j.childKey);
  if (!hasP || !hasC) bad++;
  console.log(
    `${String(i).padStart(2)} ${j.name.padEnd(12)} ${j.parentKey.padEnd(10)} -> ${j.childKey.padEnd(10)}` +
    `${hasP ? '' : '  ★父不存在'}${hasC ? '' : '  ★子不存在'}`,
  );
});
console.log('');
console.log(bad === 0 ? '✔ 全部父子 key 都能在 bodies 里找到' : `✘ ${bad} 个关节引用了不存在的刚体 key`);
