export const SQUAT_FEASIBLE = {
  q: {
    hip2: [89.99, 121.04],
    knee2: [-105.12, -61.66],
    foot2: [19.62, 32.12],
    hip0: [-15.57, -8.57],
  },
  com: {
    x: [-0.03617476162442996, 0.041508170689207965],
    y: [0.4679682667396896, 0.6004075605837205],
    z: [0.00011787296733505747, 0.05834611715701235],
  },
  cop: {
    x: [-0.12102075197509518, 0.06191947320299758],
    z: [-0.029394029576625916, 0.017012623032773615],
  },
};

const rad = (d: number): number => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const clampHip2 = (v: number): number => clamp(v, rad(SQUAT_FEASIBLE.q.hip2[0]), rad(SQUAT_FEASIBLE.q.hip2[1]));
export const clampKnee2 = (v: number): number => clamp(v, rad(SQUAT_FEASIBLE.q.knee2[0]), rad(SQUAT_FEASIBLE.q.knee2[1]));
export const clampFoot2 = (v: number): number => clamp(v, rad(SQUAT_FEASIBLE.q.foot2[0]), rad(SQUAT_FEASIBLE.q.foot2[1]));
export const clampHip0 = (v: number): number => clamp(v, rad(SQUAT_FEASIBLE.q.hip0[0]), rad(SQUAT_FEASIBLE.q.hip0[1]));

export const clampComX = (v: number): number => clamp(v, SQUAT_FEASIBLE.com.x[0], SQUAT_FEASIBLE.com.x[1]);
export const clampComZ = (v: number): number => clamp(v, SQUAT_FEASIBLE.com.z[0], SQUAT_FEASIBLE.com.z[1]);
export const clampCopX = (v: number): number => clamp(v, SQUAT_FEASIBLE.cop.x[0], SQUAT_FEASIBLE.cop.x[1]);
export const clampCopZ = (v: number): number => clamp(v, SQUAT_FEASIBLE.cop.z[0], SQUAT_FEASIBLE.cop.z[1]);

export const SQUAT_Q_MIN: [number, number, number] = [rad(SQUAT_FEASIBLE.q.hip2[0]), rad(SQUAT_FEASIBLE.q.knee2[0]), rad(SQUAT_FEASIBLE.q.foot2[0])];
export const SQUAT_Q_MAX: [number, number, number] = [rad(SQUAT_FEASIBLE.q.hip2[1]), rad(SQUAT_FEASIBLE.q.knee2[1]), rad(SQUAT_FEASIBLE.q.foot2[1])];
