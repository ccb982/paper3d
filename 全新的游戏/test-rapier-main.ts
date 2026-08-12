import RAPIER from '@dimforge/rapier3d';

const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
// ground: 薄板下沉（WorldMode 同配置）
const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(32, -0.06, 32));
world.createCollider(RAPIER.ColliderDesc.cuboid(32, 0.05, 32), gb);
// 玩家：胶囊刚体（CharacterBase 同配置）
const pb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(32, 1.05, 32));
world.createCollider(RAPIER.ColliderDesc.capsule(0.7, 0.35), pb);

const probe = (label: string, x: number) => {
  const c = world.intersectionWithShape({ x, y: 1.05, z: 32 }, new RAPIER.Quaternion(0, 0, 0, 1), new RAPIER.Capsule(0.7, 0.35), undefined, undefined, undefined, pb);
  console.log(label, '=>', c ? 'HIT!' : 'null (ok)');
};
probe('probe at own pos (expect null)', 32);
probe('probe 1m away (expect null)', 33);
probe('probe 3m away (expect null)', 35);
// 玩家胶囊底部 = 1.05-1.05 = 0，ground 顶部 = -0.01 → 间隙 0.01
probe('probe 0.6m low capsule (expect null)', 32.5);
