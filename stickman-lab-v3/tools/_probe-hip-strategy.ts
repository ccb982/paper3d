import './_boot';
import { planHipStrategy } from '../src/core/servo/hipStrategy';

const base = { mass: 70, height: 0.6, comX: 0.02, comVX: 0.1, targetX: 0, comZ: 0.01, comVZ: 0, targetZ: 0, contact: true, ankleTau: 100, ankleTauMax: 120, copMargin: 0.01 };
console.log('margin', JSON.stringify(planHipStrategy(base)));
console.log('no', JSON.stringify(planHipStrategy({ ...base, ankleTau: 10, copMargin: 0.05 })));
console.log('air', JSON.stringify(planHipStrategy({ ...base, contact: false })));
