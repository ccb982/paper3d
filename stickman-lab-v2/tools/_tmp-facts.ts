/** _tmp-facts: 腿关节轴的权威事实表
 *
 *  每个轴：物理平面 / preRing / 引擎 / 轴世界向量 / 纯度 / τmax / 实际写手
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

// 平面判定内联（不依赖 jointPlane.ts —— 老版本没这个文件，保证探针跨版本可用）
const PLANE_ZH: Record<string, string> = { frontal: '额', sagittal: '矢', torsion: '扭' };
const planeOf = (body: World['body'], nm: string, ax: number): string => {
  const i = body.dofByName(nm, ax);
  if (i < 0) return '?';
  const a = body.dofs[i]!.axisWorld;
  const ax0 = Math.abs(a[0]!), ay = Math.abs(a[1]!), az = Math.abs(a[2]!);
  if (ax0 >= ay && ax0 >= az) return 'frontal';
  if (ay >= ax0 && ay >= az) return 'torsion';
  return 'sagittal';
};

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const g = globalThis as unknown as { __PROPLOG?: Array<[number, string, number, string]> };
const E: Record<string, string> = globalThis.process!.env;
const ORIG = { ...E };

const runOne = (label: string): void => {
  g.__PROPLOG = [];
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const total = Math.round(2.4 / w.dt);
  const relStep = Math.round(2.0 / w.dt);
  for (let s = 0; s < total; s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    if (s === relStep) g.__PROPLOG!.length = 0;
  }
  const body = w.body;
  const yawOf = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * 180 / Math.PI;
  };
  console.log(`\n──── ${label} ────`);
  console.log(`  大腿vs小腿 yaw = ${(yawOf('thigh_l') - yawOf('shin_l')).toFixed(1)}°   判死=${court.fall >= 0 ? `t=${court.fall.toFixed(2)} ${court.reason}` : '未判死'}`);
  const writers2 = new Map<number, Set<string>>();
  for (const [dof, kind, , src] of g.__PROPLOG!) {
    let s = writers2.get(dof);
    if (!s) { s = new Set(); writers2.set(dof, s); }
    s.add(`${src}[${kind}]`);
  }
  for (const d of body.dofs) {
    if (!/^(hip|knee|foot|ankle)_/.test(d.name)) continue;
    const pl = planeOf(body, d.name, d.axis);
    const a = d.axisWorld;
    const ideal = pl === 'frontal' ? 0 : pl === 'sagittal' ? 2 : 1;
    const comp = ideal === 0 ? Math.abs(a[0]!) : ideal === 1 ? Math.abs(a[1]!) : Math.abs(a[2]!);
    const deg = (Math.acos(Math.min(1, comp)) * 180 / Math.PI).toFixed(0);
    const ws = writers2.get(d.dofIndex);
    console.log(
      `  ${(d.name + '/' + d.axis).padEnd(11)} | ${PLANE_ZH[pl]!.padEnd(5)} | 偏${deg.padStart(2)}° | ${String(d.tauMax).padStart(3)} |` +
      ` ${ws && ws.size ? [...ws].join(' + ') : '★ 无写手'}`,
    );
  }
};

runOne('默认');
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG, { SQC_HS_DEAD: '0' });
runOne('SQC_HS_DEAD=0（关掉位置死区门控）');
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
