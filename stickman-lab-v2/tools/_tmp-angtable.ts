/** _tmp-angtable: 目标角表 baseTable.squat.ang 的实际值（关键：几何零是否被覆盖）
 *
 *  怀疑：court.ts 的 captureAngFrom 有两次
 *    ① setup 末尾（court.ts:489）**无过滤全覆盖** → 把 baseTable 写死的
 *       hip0:0 / knee0:0 / foot0:0（几何零）覆盖成实测值
 *    ② 释放瞬间（court.ts:717）keepMode='2' 只覆盖**非轴0**
 *       ⇒ 轴0 保持 ① 写进去的实测值，**几何零没被恢复**
 *  ⇒ 于是被动张力/额状被动刚度的 ref 本身就是歪的（foot0≈12°、knee1≈14.5°）
 *     ⇒ 踝被拉向歪的 12° ⇒ 「踝随便偏移」
 *
 *  本探针打印两次 captureAngFrom 之后 baseTable.squat.ang 的实际值。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { BASE_TABLE, baseAng } from '../src/core/servo/baseTable';

(globalThis as { process?: { env?: Record<string, string> } }).process?.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;

const dumpAng = (tag: string): void => {
  const T = BASE_TABLE.squat;
  const keys = Object.keys(T.ang ?? {}).sort();
  const interesting = keys.filter((k) => /^(hip|knee|foot)[a-z_]*[01]$/.test(k));
  console.log(`\n── ${tag} ──`);
  console.log(`  轴0/1 的目标角（度）：`);
  for (const k of interesting) {
    const v = (T.ang as Record<string, number>)[k]!;
    console.log(`    ${k.padEnd(12)} = ${(v * D).toFixed(2)}°`);
  }
  console.log(`  被动刚度实际用的 ref：`);
  for (const sd of ['l', 'r'] as const) {
    for (const [nm, ax] of [['foot', 0], ['foot', 1], ['hip', 0], ['hip', 1], ['knee', 0], ['knee', 1]] as const) {
      const r = baseAng(`${nm}_${sd}`, ax);
      if (r !== undefined) console.log(`    ${nm}_${sd}/${ax} → ${(r * D).toFixed(2)}°`);
    }
  }
};

dumpAng('setup 完成后（court.ts:489 的全表覆盖已生效）');

for (let s = 0; s < Math.round(2.2 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
}
dumpAng('释放后 2.2s（KEEP=2 只覆盖非轴0）');

// 顺便：轴0 读数 0 时各轴的实际几何
console.log('\n── 各轴「读数 0」的几何含义（rest 值）──');
for (const nm of ['hip_l', 'knee_l', 'foot_l'] as const) {
  for (const ax of [0, 1] as const) {
    const i = body.dofByName(nm, ax);
    const d = body.dofs[i]!;
    const aw = d.axisWorld;
    console.log(`  ${nm}/${ax} rest=${(d.rest * D).toFixed(1)}° 世界轴=[${aw[0]!.toFixed(2)},${aw[1]!.toFixed(2)},${aw[2]!.toFixed(2)}]` +
      ` ⇒ 读数0 = 绕该轴转 ${(d.rest * D).toFixed(1)}° 的位姿`);
  }
}
