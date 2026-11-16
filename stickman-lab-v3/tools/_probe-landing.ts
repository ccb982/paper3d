/**
 * _probe-landing.ts —— 负载消力验收（§3.12）
 * 场景仿照单脚动作：侧移重心 → 抬左脚 → 受控放下 → 监测 → 回中。
 * 对比消力开/关：接触窗口内峰值力、膝屈曲量、回伸残差；两个落高验单调性。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

interface Result {
  footUp: number; vTd: number; fzPeakPct: number; kneeFlex: number; kneeEnd: number; chestEnd: number; chestFinal: number;
}

function run(enabled: boolean, hipL: number, kneeL: number, dropT: number, trace = false): Result {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.landing.opt.enabled = enabled;
  w.controller = ctl;
  w.reset();
  const W = w.sk.massTotal * 9.81;
  const kneeIdx = w.body.dofByName('knee_l', 2);
  const chest = () => w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;

  // ① 侧移重心（0.06 m/s 斜坡到 −0.16，同单脚动作）
  for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
    ctl.warner.setComTarget(0, -Math.min(0.16, 0.06 * s * w.dt));
    w.advance(1);
  }
  // ② 抬左脚并保持
  ctl.manual.setAngle('hip_l', 2, hipL);
  ctl.manual.setAngle('knee_l', 2, kneeL);
  ctl.manual.setAngle('foot_l', 2, 0.05);
  let footUp = 0;
  for (let s = 0; s < Math.round(0.5 / w.dt); s++) {
    ctl.warner.setComTarget(0, -0.16);
    w.advance(1);
    footUp = Math.max(footUp, ctl.sensors.feet[0]!.y);
  }
  // ③ 受控放下（PASSIVE=1 → 交还关节，腿自由下落——真实落地场景，消力应接管）
  const nDrop = Math.round(dropT / w.dt);
  let vTd = 0, contacted = false;
  if (process.env.PASSIVE === '1') {
    ctl.manual.clearAngle('hip_l', 2);
    ctl.manual.clearAngle('knee_l', 2);
    ctl.manual.clearAngle('foot_l', 2);
  }
  for (let s = 0; s < nDrop; s++) {
    const k = 1 - s / nDrop;
    if (process.env.PASSIVE !== '1') {
      ctl.manual.setAngle('hip_l', 2, hipL * k);
      ctl.manual.setAngle('knee_l', 2, kneeL * k);
      ctl.manual.setAngle('foot_l', 2, 0.05 * k);
    }
    ctl.warner.setComTarget(0, -0.16);
    w.advance(1);
    const f = ctl.sensors.feet[0]!;
    if (!contacted && f.loaded) { vTd = -f.vy; contacted = true; }
  }
  // ④ 监测 0.8s（落地窗口）
  let fzPeak = 0, kneeFlex = 0;
  for (let s = 0; s < Math.round(0.8 / w.dt); s++) {
    ctl.warner.setComTarget(0, -0.16);
    w.advance(1);
    const f = ctl.sensors.feet[0]!;
    if (!contacted && f.loaded) { vTd = -f.vy; contacted = true; }
    fzPeak = Math.max(fzPeak, f.fz);
    kneeFlex = Math.min(kneeFlex, w.body.dofs[kneeIdx]!.angle);
    if (trace && s % 24 === 0) {
      console.log(
        `    t=${(s * w.dt).toFixed(2)} 脚y=${f.y.toFixed(3)} vy=${f.vy.toFixed(2)} fz=${(f.fz / W * 100).toFixed(0)}%` +
        ` 膝=${w.body.dofs[kneeIdx]!.angle.toFixed(2)} 消力=${ctl.landing.depthOf(0).toFixed(2)}/${ctl.landing.targetOf(0).toFixed(2)}` +
        ` 胸=${chest().toFixed(2)}`
      );
    }
  }
  const chestEnd = chest();
  const kneeEnd = w.body.dofs[kneeIdx]!.angle;
  return { footUp, vTd, fzPeakPct: (fzPeak / W) * 100, kneeFlex, kneeEnd, chestEnd, chestFinal: chestEnd };
}

for (const [label, hipL, kneeL, dropT] of [
  ['低落点（0.5s 慢放）', 0.30, -0.50, 0.5],
  ['高落点（0.2s 快放）', 0.55, -0.90, 0.2],
] as Array<[string, number, number, number]>) {
  console.log(`— ${label} —`);
  for (const enabled of [false, true]) {
    const r = run(enabled, hipL, kneeL, dropT);
    console.log(
      `${enabled ? '开' : '关'}：抬脚=${(r.footUp * 100).toFixed(0)}cm vTd=${r.vTd.toFixed(2)} 峰Fz=${r.fzPeakPct.toFixed(0)}%` +
      ` 膝最深=${r.kneeFlex.toFixed(2)} 窗末膝=${r.kneeEnd.toFixed(3)} 窗末胸=${r.chestEnd.toFixed(2)} 回中后胸=${r.chestFinal.toFixed(2)}`
    );
  }
}
