/**
 * probe-pd.ts —— 单独验证 C1 位置环 PD 的符号与增益
 * 用法：node tools/run.mjs probe-pd
 *
 * 场景：重力关、零外力、目标角 0（静姿态）。
 * 期望：**任何** kP/kD 下 Σ|Δθ| 都应随 kP 增大而更快收敛（不是发散）。
 * 若 kP 越大越发散 ⇒ 符号错（正反馈）。
 */
import './_boot';
import { World, DEFAULT_WORLD_OPTIONS } from '../src/core/world';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const FRAMES = Number(ARGS[0] ?? 240);

function run(kP: number, kD: number, alpha: number, label: string) {
  const w = new World({
    ...DEFAULT_WORLD_OPTIONS,
    drive: { ...DEFAULT_WORLD_OPTIONS.drive, kP, kD, motorAlpha: alpha },
  });
  w.setGravityZero();
  w.body.reset();
  w.advance(FRAMES);
  const nj = w.sk.joints.length;
  const rr = new Float64Array(3), rv = new Float64Array(3);
  let s = 0, sv = 0;
  for (let i = 0; i < nj; i++) {
    w.body.jointRot(i, rr);
    w.body.jointRelVel(i, rv);
    for (let k = 0; k < 3; k++) { s += Math.abs(rr[k]!) * 180 / Math.PI; sv += Math.abs(rv[k]!); }
  }
  const y = w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y;
  console.log(`${label.padEnd(34)} Σ|Δθ|=${s.toFixed(2).padStart(10)}°  Σ|ω|=${sv.toFixed(3).padStart(10)}  spine4.y=${y.toFixed(4)}  sat=${w.drive.lastWrote.saturated}`);
  return s;
}

console.log('════ C1 位置环 PD 增益扫描（重力关，目标角 0，240 拍） ════');
run(0, 0, 1.0, 'kP=0   kD=0   α=1（无驱动）');
run(0, 1.0, 1.0, 'kP=0   kD=1   α=1（纯阻尼）');
run(1, 0, 1.0, 'kP=1   kD=0   α=1');
run(4, 0, 1.0, 'kP=4   kD=0   α=1');
run(12, 0, 1.0, 'kP=12  kD=0   α=1');
run(48, 0, 1.0, 'kP=48  kD=0   α=1');
run(48, 1.0, 1.0, 'kP=48  kD=1   α=1（当前默认）');
run(48, 1.0, 0.35, 'kP=48  kD=1   α=0.35');
run(48, 1.0, 0.1, 'kP=48  kD=1   α=0.1');
