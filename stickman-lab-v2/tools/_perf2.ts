/** _perf2.ts —— 开销分解：求解器配置/物体数 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function bench(label: string, body: object): void {
  const w = new World({ physicsHz: 480, body: body as never });
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  for (let i = 0; i < 960; i++) w.advance(1);
  const t0 = performance.now();
  for (let i = 0; i < 1920; i++) w.advance(1);
  const ms = performance.now() - t0;
  console.log(`${label}: ${(ms / 1920).toFixed(3)} ms/步  物体=${w.body.allBodies.length} 逻辑体=${w.body.bodies.length}`);
}
bench('默认(16/8/32)', {});
bench('求解8/摩擦2   ', { solverIterations: 8, frictionIterations: 2 });
bench('求解4/摩擦2/无附加', { solverIterations: 4, frictionIterations: 2, gimbalMidExtraIters: 0 });
bench('求解1/摩擦1/无附加', { solverIterations: 1, frictionIterations: 1, gimbalMidExtraIters: 0 });
