/** _probe-brace.ts —— ★ 自动撑地验收（P1，用户定调）：支撑属伺服、属自动化撑地。
 *
 * 场景：直控把左腿抬起（主动构型）→ **交还**（清手动角，腿变成"无人指挥"）→
 * 腿自由下落。期望：伺服在落点临近时**自动预撑**（给落腿屈膝缓冲配置），
 * 触地即能承重，身体稳住不摔。
 * A/B：NO_BRACE=1 关掉伺服预撑（对照）。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
if (process.env.NO_BRACE === '1') {
  (ctl.landing as unknown as { setPreBrace: () => void }).setPreBrace = () => {};   // A/B：关自动撑地
}
w.controller = ctl;
w.reset();

const chest = () => w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y;
const W = () => w.sk.massTotal * 9.81;
const line = (tag: string) => {
  const sup = ctl.lastProposal?.support;
  const p = ctl.lastProposal?.reflexDirectives.map((d) => d.id).join('+') ?? '';
  console.log(
    `${tag}: comX=${ctl.sensors.com[0]!.toFixed(3)} comZ=${ctl.sensors.com[2]!.toFixed(3)} 胸=${chest().toFixed(3)}` +
    ` Lfz=${(ctl.sensors.feet[0]!.fz / W() * 100).toFixed(0)}% 撑深=${ctl.landing.depthOf(0).toFixed(3)}` +
    (sup ? ` [${sup.phase}${sup.suggest !== 'ok' ? '/' + sup.suggest : ''} | ${p}]` : '')
  );
};

for (let s = 0; s < Math.round(1.0 / w.dt); s++) w.advance(1);
line('① 站定     ');

// ② 转移（主动方发话；等到重心真正到支撑脚上——comZ < −0.12——或 12s 超时）
for (let s = 0; s < Math.round(12.0 / w.dt); s++) {
  ctl.warner.setComTarget(0, -0.16);
  w.advance(1);
  if (ctl.sensors.com[2]! < -0.12) break;
}
line('② 转移后   ');

// ③ 抬腿（主动构型）并保持
ctl.manual.setAngle('hip_l', 2, 0.45);
ctl.manual.setAngle('knee_l', 2, -0.75);
ctl.manual.setAngle('foot_l', 2, 0.08);
let minChest = 9;
for (let s = 0; s < Math.round(1.0 / w.dt); s++) {
  ctl.warner.setComTarget(0, -0.16);
  w.advance(1);
  minChest = Math.min(minChest, chest());
}
line('③ 单支撑保持');
console.log(`   （期间最低胸=${minChest.toFixed(3)}）`);

// ③.7 负载测试：给全身一个向下速度冲量（模拟负重/重落地）→ 支撑膝受压；
//      伺服应触发"支撑腿撑住"（load）把膝托住（A/B：NO_LOAD=1 关掉）。
if (process.env.NO_LOAD === '1') {
  (ctl.lean as unknown as { applyLoadBrace: () => void }).applyLoadBrace = () => {};
}
const kneeR = w.body.dofByName('knee_r', 2);
let loadSteps = 0, minKnee = 0;
for (const b of w.body.bodies) b.applyImpulse({ x: 0, y: -b.mass() * 0.8, z: 0 }, true);
for (let s = 0; s < Math.round(0.8 / w.dt); s++) {
  ctl.warner.setComTarget(0, -0.16);
  w.advance(1);
  if (ctl.lastProposal?.reflexDirectives.some((d) => d.id === 'load')) loadSteps++;
  minKnee = Math.min(minKnee, w.body.dofs[kneeR]!.angle);
}
console.log(`③.7 负载：支撑膝最深=${minKnee.toFixed(3)} rad  撑住触发=${loadSteps} 步  胸=${chest().toFixed(3)}`);

// ③.5 交还：腿变成无人指挥（这就是"自动撑地"该接管的时刻）
ctl.manual.clearAngle('hip_l', 2);
ctl.manual.clearAngle('knee_l', 2);
ctl.manual.clearAngle('foot_l', 2);

// ④ 观察 2.5s
minChest = 9;
for (let s = 0; s < Math.round(2.5 / w.dt); s++) {
  w.advance(1);
  minChest = Math.min(minChest, chest());
  if (s % 120 === 0) line(`④ t=${(s * w.dt).toFixed(1)}s`);
}
line('④ 结束     ');
console.log(`判定：交还后最低胸=${minChest.toFixed(3)}（>1.20 ${minChest > 1.20 ? '✓' : '✗'}） 末comX=${ctl.sensors.com[0]!.toFixed(3)} 末comZ=${ctl.sensors.com[2]!.toFixed(3)}`);
