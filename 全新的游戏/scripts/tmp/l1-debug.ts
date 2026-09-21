import { TerrainSemantics, Sem, SEM_NAMES } from '../../src/systems/swarm/TerrainSemantics';
const saddle = (x: number, z: number): number => {
  const a = Math.exp(-(((x + 14) ** 2 + (z + 40) ** 2)) / (2 * 8 * 8));
  const b = Math.exp(-(((x - 18) ** 2 + (z + 40) ** 2)) / (2 * 8 * 8));
  return 20 * (a + b);
};
const l1 = new TerrainSemantics();
l1.build({ heightAt: saddle, roleAt: () => 'ground' }, 0, 0);
for (const [x, z] of [[2, -38], [2, -42], [2, -34], [6, -38], [-2, -38]] as const) {
  console.log(`(${x},${z})`, SEM_NAMES[l1.classAt(x, z)], 'w=', l1.widthAt(x, z).toFixed(2),
    'slope=', l1.slopeAt(x, z).toFixed(3), 'aspect=', l1.aspectAt(x, z).toFixed(3),
    'h=', l1.smoothHeightAt(x, z).toFixed(2), 'raw=', l1.rawHeightAt(x, z).toFixed(2),
    'pass=', l1.isPassableAt(x, z));
}
