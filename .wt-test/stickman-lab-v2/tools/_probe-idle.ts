/** _probe-idle.ts —— 空闲行为验收（动作层）：30s 无操作，随机插入微摆/重心转移/上身调整。
 *  判定：不摔（胸>1.3）、重心带受限（横向 |z|<0.08、纵向 |x−standX|<0.06）、触发次数>4。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const chest = (): number => w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y;
let lastId = '', lastPhase = ''; let lastActive = false;
const kinds: Record<string, number> = {};
let events = 0, minChest = 9, minX = 9, maxX = -9, minZ = 9, maxZ = -9, maxTilt = 0;
for (let s = 0; s < Math.round(30 / w.dt); s++) {
  w.advance(1);
  const st = ctl.actions.status;
  if (!lastActive && st.active) {
    events++; kinds[st.id ?? '?'] = (kinds[st.id ?? '?'] ?? 0) + 1;
    console.log(`t=${(s * w.dt).toFixed(1)}s  空闲事件开始（${st.id}）`);
  }
  lastActive = st.active;
  maxTilt = Math.max(maxTilt, Math.abs(ctl.sensors.torsoTilt[0]!));   // ★ 躯干最大倾角
  lastId = st.id ?? ''; lastPhase = st.phase ?? '';
  minChest = Math.min(minChest, chest());
  minX = Math.min(minX, ctl.sensors.com[0]!); maxX = Math.max(maxX, ctl.sensors.com[0]!);
  minZ = Math.min(minZ, ctl.sensors.com[2]!); maxZ = Math.max(maxZ, ctl.sensors.com[2]!);
}
console.log(`── 汇总：触发 ${events} 次 ${JSON.stringify(kinds)}`);
console.log(`   最低胸=${minChest.toFixed(3)}  comX∈[${minX.toFixed(3)},${maxX.toFixed(3)}]  comZ∈[${minZ.toFixed(3)},${maxZ.toFixed(3)}]  ` +
  `躯干最大倾角=${(maxTilt * 180 / Math.PI).toFixed(1)}°  ${minChest > 1.3 && events >= 4 ? '通过 ✓' : '未达标 ✗'}`);
