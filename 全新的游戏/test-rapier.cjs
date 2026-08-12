(async () => {
  const mod = await import('./node_modules/@dimforge/rapier3d/rapier.js');
  const RAPIER = mod.default;
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const gb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(32, -0.06, 32));
  world.createCollider(RAPIER.ColliderDesc.cuboid(32, 0.05, 32), gb);
  const pb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(32, 1.05, 32));
  world.createCollider(RAPIER.ColliderDesc.capsule(0.7, 0.35), pb);
  const probe = (label, x) => {
    const c = world.intersectionWithShape({ x, y: 1.05, z: 32 }, new RAPIER.Quaternion(0, 0, 0, 1), new RAPIER.Capsule(0.7, 0.35), undefined, undefined, undefined, pb);
    console.log(label, '=>', c ? 'HIT' : 'null');
  };
  probe('probe own pos (expect null)', 32);
  probe('probe 1m away (expect null)', 33);
  probe('probe 3m away (expect null)', 35);
})();
