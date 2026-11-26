export interface FootContactTaskInput {
  contact: boolean;
  copInside: boolean;
  fz: number;
  fzMin: number;
  targetP: { x: number; y: number; z: number };
  actualP: { x: number; y: number; z: number };
  targetQ: { x: number; y: number; z: number; w: number };
  actualQ: { x: number; y: number; z: number; w: number };
  linVel: { x: number; y: number; z: number };
  angVel: { x: number; y: number; z: number };
  posMargin: number;
  rotMargin: number;
  linVelMargin: number;
  angVelMargin: number;
}

export interface FootContactTaskOutput {
  gripOk: boolean;
  posErr: number;
  rotErr: number;
  linVelErr: number;
  angVelErr: number;
  copOk: boolean;
  fzOk: boolean;
}

function qNorm(q: { x: number; y: number; z: number; w: number }): number {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

function qDot(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

export function evalFootContactTask(i: FootContactTaskInput): FootContactTaskOutput {
  const dx = i.actualP.x - i.targetP.x;
  const dy = i.actualP.y - i.targetP.y;
  const dz = i.actualP.z - i.targetP.z;
  const posErr = Math.hypot(dx, dy, dz);
  const n1 = qNorm(i.targetQ), n2 = qNorm(i.actualQ);
  const dot = n1 > 1e-9 && n2 > 1e-9 ? Math.abs(qDot(i.targetQ, i.actualQ) / (n1 * n2)) : 0;
  const rotErr = 2 * Math.acos(Math.max(-1, Math.min(1, dot)));
  const linVelErr = Math.hypot(i.linVel.x, i.linVel.y, i.linVel.z);
  const angVelErr = Math.hypot(i.angVel.x, i.angVel.y, i.angVel.z);
  const copOk = i.copInside;
  const fzOk = i.fz >= i.fzMin;
  const gripOk = i.contact && copOk && fzOk
    && posErr <= i.posMargin
    && rotErr <= i.rotMargin
    && linVelErr <= i.linVelMargin
    && angVelErr <= i.angVelMargin;
  return { gripOk, posErr, rotErr, linVelErr, angVelErr, copOk, fzOk };
}
