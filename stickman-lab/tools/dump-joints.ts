/**
 * dump-joints —— 打印关节与刚体结构（普查前的信息收集）
 * 用法：node tools/run.mjs dump-joints
 */
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
console.log(`关节数=${sk.joints.length}  刚体数=${sk.bodies.length}  总质量=${sk.massTotal.toFixed(2)} kg`);
console.log('');
console.log('idx | name            | parent        -> child        | τmax[0 1 2]        | 限位(deg)[0 1 2]');
console.log('----+-----------------+-------------------------------+--------------------+---------------------');
(sk.joints as any[]).forEach((j: any, i: number) => {
  const tm = (j.maxTorque ?? [0, 0, 0]).map((v: number) => Number(v).toFixed(0).padStart(4)).join(' ');
  const lim = (j.limits ?? []).map((L: any) => {
    if (!L) return '  --  ';
    const a = (L[0] * 180 / Math.PI).toFixed(0).padStart(4);
    const b = (L[1] * 180 / Math.PI).toFixed(0).padStart(4);
    return `${a}~${b}`;
  }).join(' ');
  console.log(
    `${String(i).padStart(3)} | ${String(j.name).padEnd(15)} | ${String(j.parentKey ?? '?').padEnd(13)} -> ${String(j.childKey ?? '?').padEnd(13)} | ${tm} | ${lim}`,
  );
});
console.log('');
console.log('刚体：');
(sk.bodies as any[]).forEach((b: any, i: number) => {
  const size = b.size ?? b.dims ?? b.half ?? null;
  console.log(`  ${String(i).padStart(2)} ${String(b.key).padEnd(14)} m=${(b.mass ?? 0).toFixed(3)}kg  ${JSON.stringify(size)}`);
});
