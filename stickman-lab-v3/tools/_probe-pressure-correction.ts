import './_boot';
import { correctPressure } from '../src/core/servo/pressureCorrection';
console.log(JSON.stringify(correctPressure({ fzDes: 400, fzAct: 350, copDes: 0.02, copAct: 0.01, footX: 0, halfX: 0.12, margin: 0.02, tauMax: 30 }), null, 2));
