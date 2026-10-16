/** _tmp-subtree.ts —— 查 subtree[joint] 实际包含哪些体段（gcomp 浮动基座修正用） */
import './_boot';
import { World } from '../src/core/world';
const w = new World();
w.reset();
const body = w.body;
for (const [jn, ax] of [['hip_r', 0], ['knee_r', 0], ['foot_r', 0], ['hip_l', 0]] as Array<[string, number]>) {
  const di = body.dofByName(jn, ax);
  if (di < 0) { console.log(`${jn}/${ax}: 无此自由度`); continue; }
  const d = body.dofs[di]!;
  const keys = [...body.indexByKey.entries()].filter(([, bi]) => body.subtree[d.joint]!.includes(bi)).map(([k]) => k);
  console.log(`${jn}/${ax}: joint=${d.joint} 子树=[${keys.join(',')}]`);
}
console.log(`全部体段: [${[...body.indexByKey.keys()].join(',')}]`);
