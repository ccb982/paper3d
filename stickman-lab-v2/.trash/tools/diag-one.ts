/**
 * diag-one.ts —— 单变量逐案探针（每个 case 独立 World，严格 free）
 * 用法：node tools/run.mjs diag-one <case>
 *       node tools/run.mjs diag-one all
 *
 * 目的：把此前探针里"一个进程连跑多个 case"造成的互相污染彻底消除。
 *       每个 case：新建 World → 装配 → step 10 步 → 打印 → free World。
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const args = (globalThis as unknown as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const which = args[0] ?? 'all';
const sk = buildSkeleton(DEFAULT_CONFIG);

interface Case { label: string; fn: () => void; }
const cases: Case[] = [];

/** 统一装配器 */
function buildWorld(opts: {
  keys: string[] | 'all';
  useRealColliders?: boolean;
  useSkeletonPos?: boolean;
  useRestQuat?: boolean;
  useMassProps?: boolean;
  joints?: boolean;
  flexibleArch?: boolean;
  ground?: boolean;
}): { w: RAPIER.World; rbs: RAPIER.RigidBody[]; keys: string[] } {
  const cfg = opts.flexibleArch === undefined ? DEFAULT_CONFIG : { ...DEFAULT_CONFIG, flexibleArch: opts.flexibleArch };
  const skk = opts.flexibleArch === undefined ? sk : buildSkeleton(cfg);
  const keys = opts.keys === 'all' ? skk.bodies.map((b) => b.key) : opts.keys;
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 8;
  const rbs: RAPIER.RigidBody[] = [];
  const idx = new Map<string, number>();
  keys.forEach((k, n) => {
    const b = skk.bodies.find((x) => x.key === k);
    if (!b) throw new Error(`body ${k} 不存在`);
    idx.set(k, n);
    let d = RAPIER.RigidBodyDesc.dynamic();
    d = opts.useSkeletonPos === false
      ? d.setTranslation(n * 0.6, 1 + n * 0.4, 0)
      : d.setTranslation(b.cx, b.cy, b.cz);
    if (opts.useRestQuat !== false) {
      const q = restQuatOf(b.restTiltRad, b.restYawRad);
      d = d.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
    }
    d = d.setCanSleep(false);
    const rb = w.createRigidBody(d);
    if (opts.useRealColliders !== false) {
      b.colliders.forEach((c) => {
        const desc = c.shape === 'capsule'
          ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
          : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
        desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0);
        if (opts.useMassProps !== false) {
          desc.setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
            { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 });
        }
        desc.setFriction(0.5).setRestitution(0);
        w.createCollider(desc, rb);
      });
    } else {
      w.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1), rb);
    }
    rbs.push(rb);
  });
  if (opts.joints) {
    skk.joints.forEach((j) => {
      const pi = idx.get(j.parentKey), ci = idx.get(j.childKey);
      if (pi === undefined || ci === undefined) return;
      const a1 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
      const a2 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };
      const jd = j.revoluteAxis
        ? RAPIER.JointData.revolute(a1, a2, { x: j.revoluteAxis[0], y: j.revoluteAxis[1], z: j.revoluteAxis[2] })
        : RAPIER.JointData.spherical(a1, a2);
      w.createImpulseJoint(jd, rbs[pi]!, rbs[ci]!, true);
    });
  }
  if (opts.ground) {
    const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    w.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 12).setTranslation(0, -0.5, 0).setFriction(1.0), g);
  }
  return { w, rbs, keys };
}

function runCase(label: string, opts: Parameters<typeof buildWorld>[0], steps = 10) {
  let w: RAPIER.World | null = null;
  try {
    const built = buildWorld(opts);
    w = built.w;
    let badAt = -1, badKey = '';
    for (let s = 0; s < steps; s++) {
      w.step();
      for (let i = 0; i < built.rbs.length; i++) {
        if (!Number.isFinite(built.rbs[i]!.translation().x)) { badAt = s + 1; badKey = built.keys[i]!; break; }
      }
      if (badAt > 0) break;
    }
    console.log(`${label.padEnd(46)} ${badAt > 0 ? `✘ step${badAt} NaN @${badKey}` : `✔ ${steps} 步稳定`}`);
  } catch (e) {
    console.log(`${label.padEnd(46)} ✘ 异常: ${(e as Error).message}`);
  } finally {
    try { w?.free(); } catch { /* ignore */ }
  }
}

console.log('════ 单变量逐案（每案独立 World + free） ════');
const all = which === 'all';
const doCase = (name: string) => all || which === name;

if (doCase('full')) runCase('全 19 体 + 18 关节 + 地面', { keys: 'all', joints: true, ground: true });
if (doCase('full-noground')) runCase('全 19 体 + 18 关节（无地面）', { keys: 'all', joints: true });
if (doCase('full-nojoint')) runCase('全 19 体（无关节无地面）', { keys: 'all' });
if (doCase('flexoff')) runCase('15 体(flexibleArch=false) + 14 关节', { keys: 'all', joints: true, flexibleArch: false });
if (doCase('flexoff-noground')) runCase('15 体(flexibleArch=false) 无关节', { keys: 'all', flexibleArch: false });
if (doCase('pair')) runCase('2 体 spine4+head 真collider', { keys: ['spine4', 'head'] });
if (doCase('pair-fixed')) runCase('2 体 spine4+head 固定盒', { keys: ['spine4', 'head'], useRealColliders: false });
if (doCase('pair-nomass')) runCase('2 体 spine4+head 真collider 不设质量', { keys: ['spine4', 'head'], useMassProps: false });
if (doCase('pair-noquat')) runCase('2 体 spine4+head 单位四元数', { keys: ['spine4', 'head'], useRestQuat: false });
if (doCase('footchain')) runCase('4 体 foot+arch+mfoot+shin', { keys: ['shin_l', 'foot_l', 'arch_l', 'mfoot_l'] });
