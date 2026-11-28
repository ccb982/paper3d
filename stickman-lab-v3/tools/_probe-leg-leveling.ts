import './_boot';
import { planLegLeveling } from '../src/core/servo/legLeveling';
console.log(JSON.stringify(planLegLeveling({ contact: true, rollErr: -0.3, pitchErr: 0.1, hipRoll: 0.05, hipPitch: 0.02, maxHipRoll: 0.12, maxHipPitch: 0.12, kpRoll: 0.4, kpPitch: 0.4 }), null, 2));
