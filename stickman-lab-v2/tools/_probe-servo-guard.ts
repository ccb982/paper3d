/** _probe-servo-guard.ts —— 伺服职责验收（直控，不经动作层）：
 *  A 过大的侧移目标 → 伺服限幅（别太过）
 *  B 直控抬腿（主动方只抬腿、不管重心）→ 伺服自己把重心管到支撑脚上
 *  C 放腿（双支撑）→ 目标过期 → 伺服自动回正到中线
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
if (process.env.NO_LANDING === '1') ctl.landing.opt.enabled = false;
if (process.env.BEND_SIGN !== undefined) ctl.warner.opt.bendSign = Number(process.env.BEND_SIGN);
w.controller = ctl;
w.reset();
const chest = () => w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y;
const show = (tag: string) => console.log(
  `${tag}: comX=${ctl.sensors.com[0]!.toFixed(3)} comZ=${ctl.sensors.com[2]!.toFixed(3)} 目标z=${ctl.warner.getComTarget().z.toFixed(3)} 胸=${chest().toFixed(3)}`
);
for (let s = 0; s < Math.round(1.0 / w.dt); s++) w.advance(1);
show('① 站定     ');

// A: 过大侧移目标（主动方乱来）
ctl.warner.setComTarget(0, -0.30);
let minChest = 9;
for (let s = 0; s < Math.round(1.5 / w.dt); s++) { w.advance(1); minChest = Math.min(minChest, chest()); }
show('② 过大目标 ');
console.log(`   （期间最低胸=${minChest.toFixed(3)}）`);

// B: 真实工作流——主动方先给侧移目标（持续发话）→ 抬腿 → 保持（伺服负责稳住）
minChest = 9;
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {           // 主动方：0.06 m/s 斜坡到 −0.16
  const tt = s * w.dt;
  ctl.warner.setComTarget(0, -Math.min(0.16, 0.06 * tt));
  w.advance(1);
  minChest = Math.min(minChest, chest());
}
show('③a 转移后  ');
console.log(`   （期间最低胸=${minChest.toFixed(3)}）`);
ctl.manual.setAngle('hip_l', 2, 0.45);                        // 抬腿（主动构型切换）
ctl.manual.setAngle('knee_l', 2, -0.75);
ctl.manual.setAngle('foot_l', 2, 0.08);
minChest = 9;
for (let s = 0; s < Math.round(1.5 / w.dt); s++) {
  ctl.warner.setComTarget(0, -0.16);                          // 主动方持续发话
  w.advance(1);
  minChest = Math.min(minChest, chest());
  if (s % 240 === 0) {
    const sup = ctl.lastProposal?.support;
    console.log(`  B t=${(s * w.dt).toFixed(1)}s comX=${ctl.sensors.com[0]!.toFixed(3)} comZ=${ctl.sensors.com[2]!.toFixed(3)} 胸=${chest().toFixed(3)}` +
      (sup ? ` [${sup.mode}/${sup.phase} mX=${sup.marginX.toFixed(3)} mZ=${sup.marginZ.toFixed(3)} supZ=${sup.supZ.toFixed(3)} ${sup.loadOk ? 'load' : 'NO-load'}]` : ''));
  }
}
show('③b 单支撑保持');
console.log(`   （期间最低胸=${minChest.toFixed(3)}）`);
const holdMin = minChest;

// C: 放腿（受控缓放 0.5s）+ 停止发话 → 伺服收拾（目标过期 → 回正）
for (let s = 0; s < Math.round(0.5 / w.dt); s++) {
  const k = 1 - s / (0.5 / w.dt);
  ctl.manual.setAngle('hip_l', 2, 0.45 * k);
  ctl.manual.setAngle('knee_l', 2, -0.75 * k);
  ctl.manual.setAngle('foot_l', 2, 0.08 * k);
  w.advance(1);
  if (s % 24 === 0) {
    const W = w.sk.massTotal * 9.81;
    console.log(
      `  放 t=${(s / 480).toFixed(2)} comX=${ctl.sensors.com[0]!.toFixed(3)} comZ=${ctl.sensors.com[2]!.toFixed(3)} 胸=${chest().toFixed(3)}` +
      ` Lz=${ctl.sensors.feet[0]!.z.toFixed(2)} Lfz=${(ctl.sensors.feet[0]!.fz / W * 100).toFixed(0)}% Rfz=${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0)}%`
    );
  }
}
for (let s = 0; s < Math.round(3.5 / w.dt); s++) {
  w.advance(1);
  if (s % 120 === 0) {
    const p = ctl.lastProposal!;
    const dirs = p.reflexDirectives.map((d) => d.id === 'bend'
      ? `bend(spine=${(d.params?.spine ?? 0).toFixed(3)})` : d.id === 'lean'
      ? `lean(copZ=${(d.params?.copZ ?? 0).toFixed(3)})` : d.id).join(' ');
    console.log(`④ t=${(s / 480).toFixed(1)}s: comX=${ctl.sensors.com[0]!.toFixed(3)} vx=${ctl.sensors.comVel[0]!.toFixed(2)} comZ=${ctl.sensors.com[2]!.toFixed(3)} 胸=${chest().toFixed(3)} [L${p.level} ${p.reason} | ${dirs}]`);
  }
}
show('④ 停止发话后');
const endChest = chest();
console.log(`判定：③b最低胸=${holdMin.toFixed(3)}（>1.30 ${holdMin > 1.30 ? '✓' : '✗'}） ④末胸=${endChest.toFixed(3)}（>1.20 ${endChest > 1.20 ? '✓' : '✗'}） ④末comX=${ctl.sensors.com[0]!.toFixed(3)}`);
