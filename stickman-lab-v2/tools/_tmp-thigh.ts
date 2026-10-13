import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const drive = (ctl as any).drive ?? (w as any).drive;
const bd = (n: string, ax: number): Record<string, number> => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (drive?.lastBreakdown?.[di] ?? {}) : {};
};
const tau = (n: string, ax: number): number => {
  const b = bd(n, ax);
  return (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0) + (b.stiff ?? 0);
};
const ang = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? body.dofs[di]!.angle * 57.3 : NaN;
};
const roll = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return NaN;
  const q = body.bodies[ix].rotation();
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
};
{
  const d0 = (drive as any);
  const act = d0?.actuator;
  const diH = body.dofByName('hip_r', 0);
  console.log(`[cfg2] hipInertia=${body.dofs[diH]!.inertia.toExponential(3)} inertiaLow=${(body.dofs[diH] as any).inertiaLow?.toExponential(3)} tCap_old=${(body.dofs[diH]!.inertia*9*240).toFixed(1)}`);
console.log(`[cfg] itbStiff=${d0?.opt?.itbStiffness} passiveDampFrac=${act?.opt?.passiveDampingFrac} hipB=${act?.dampingOf ? act.dampingOf(diH).toFixed(3) : '?'} hipTauMax=${body.dofs[diH]!.tauMax}`);
}
console.log('t 相 | comZ vZ aZ(cm/s\u00b2) | \u9acb0\u03c4(\u5404\u901a\u9053) | \u9acb0\u89d2\u901f|\u5927\u817fR\u00b0 | \u4f20\u9012\u7387\u5b9e\u6d4b | \u9700\u6c42a\u2248-vZ/0.15');
let pv = 0;
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.97 || t > 4.10) continue;   // ★ 240Hz 逐帧窗口（高频直读）
  {
    const diH = body.dofByName('hip_r', 0);
    const dv = body.dofs[diH]!.vel;
    const bb = bd('hip_r', 0);
    const inert = (body.dofs[diH] as any).inertia as number;
    const inertLow = (body.dofs[diH] as any).inertiaLow as number;
    {
      // ★ 支点几何：骨盆的ωx vs 自身横移速度 → r=vz/ωx
      const pIdx = body.indexByKey.get('torso') ?? body.indexByKey.get('spine4');
      const tIdx = body.indexByKey.get('thigh_r');
      if (pIdx != null && tIdx != null) {
        const pb = body.bodies[pIdx]!;
        const tb = body.bodies[tIdx]!;
        const pw = pb.angvel(); const pv = pb.linvel();
        const tw = tb.angvel(); const tv = tb.linvel();
        const rp = Math.abs(pw.x) > 0.1 ? pv.z / pw.x : NaN;
        {
      const diH0a = body.dofByName('hip_r', 0);
      const aw = body.dofs[diH0a]!.axisWorld;
      console.log(`  [轴向] t=${t.toFixed(3)} hip_r/0 axisWorld=(${aw[0]!.toFixed(2)},${aw[1]!.toFixed(2)},${aw[2]!.toFixed(2)})  与水平夹角=${(Math.asin(Math.min(1, Math.abs(aw[1]!))) * 57.3).toFixed(1)}°  侧向分量=${Math.abs(aw[2]!).toFixed(2)}`);
    }
    {
      const sIdx = body.indexByKey.get('shin_r');
      const fIdx = body.indexByKey.get('foot_r');
      const sw = sIdx != null ? body.bodies[sIdx]!.angvel().x : NaN;
      const fw = fIdx != null ? body.bodies[fIdx]!.angvel().x : NaN;
      console.log(`  [链] t=${t.toFixed(3)} 大腿ωx=${tw.x.toFixed(2)} 小腿ωx=${sw.toFixed(2)} 足ωx=${fw.toFixed(2)} | 髋节=${body.dofs[body.dofByName('hip_r', 0)]!.vel.toFixed(2)} 膝节=${body.dofs[body.dofByName('knee_r', 2)]!.vel.toFixed(2)} 踝节=${body.dofs[body.dofByName('foot_r', 0)]!.vel.toFixed(2)}`);
    }
    console.log(`  [支点] t=${t.toFixed(3)} 骨盆 ωx=${pw.x.toFixed(2)} vz=${(pv.z * 100).toFixed(1)}cm/s r=${Number.isFinite(rp) ? (rp * 100).toFixed(1) : '--'}cm | 大腿 ωx=${tw.x.toFixed(2)} vz=${(tv.z * 100).toFixed(1)} | 髋关节速=${body.dofs[body.dofByName('hip_r', 0)]!.vel.toFixed(2)}`);
      }
    }
    {
      const pi = body.indexByKey.get('torso') ?? body.indexByKey.get('spine4') ?? body.indexByKey.get('spine1');
      const pb = pi != null ? body.bodies[pi]! : null;
      const wx = pb ? pb.angvel().x : 0;
      const Ip = pb ? (pb.principalInertia?.() as { x: number; y: number; z: number } | undefined)?.x ?? 0 : 0;
      const prev = (globalThis as unknown as { __pw?: number }).__pw ?? wx;
      const alpha = (wx - prev) / (1 / 240);
      (globalThis as unknown as { __pw?: number }).__pw = wx;
      const recv = Ip * alpha;
      console.log(`  [240Hz] t=${t.toFixed(3)} 髋act=${(bb.act ?? 0).toFixed(0)} 净=${tau('hip_r', 0).toFixed(0)} | 骨盆ωx=${wx.toFixed(2)} α=${alpha.toFixed(0)} I=${Ip.toFixed(2)} 收到=${recv.toFixed(0)}  传输率=${Math.abs(tau('hip_r', 0)) > 30 ? (recv / tau('hip_r', 0)).toFixed(2) : '--'}`);
    }
  }
  const vZ = ctl.sensors.comVel[2]!;
  const aZ = (vZ - pv) / (1 / 100);
  pv = vZ;
  const b = bd('hip_r', 0);
  const ch = `${(b.act ?? 0).toFixed(0)}|${(b.ff ?? 0).toFixed(0)}|${(b.damp ?? 0).toFixed(0)}|${(b.stiff ?? 0).toFixed(0)}|${(b.itb ?? 0).toFixed(0)}`;
  const hv = body.dofs[body.dofByName('hip_r', 0)]!.vel;
  // \u4f20\u9012\u7387 = \u5b9e\u6d4ba / \u540d\u4e49a(\u03c4/15)
  const ratio = Math.abs(tau('hip_r', 0)) > 20 ? (aZ / (tau('hip_r', 0) / 15)) : NaN;
  const need = -vZ / 0.15;
  console.log(`${t.toFixed(2)} ${(ctl.actions.status.phase ?? '?').slice(0, 1)} | ${(ctl.sensors.com[2]! * 100).toFixed(1).padStart(6)} ${(vZ * 100).toFixed(1).padStart(6)} ${(aZ * 100).toFixed(1).padStart(7)} | ${tau('hip_r', 0).toFixed(0).padStart(4)}(${ch}) | ${hv.toFixed(2).padStart(5)} ${roll('thigh_r').toFixed(0).padStart(4)} | ${Number.isFinite(ratio) ? ratio.toFixed(2).padStart(6) : '   -- '} | ${(need * 100).toFixed(1).padStart(6)}`);
}
