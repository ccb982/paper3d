/**
 * supportDyn —— 矢状 3 DOF 动态支撑前馈：M(q)qdd + C(q,qd)。
 * 不包含 G/contact，因为 tauBase 已经包含静态支撑，避免重复。
 */
import type { World } from '../world';
import { qMul, qRotateVec, qInvRotateVec, qAxisAngle, type Quat } from '../quat';

const cross=(ax:number,ay:number,az:number,bx:number,by:number,bz:number):[number,number,number]=>[ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];
function inertiaWith(q:Quat,b:{principalInertia():{x:number;y:number;z:number};principalInertiaLocalFrame():{x:number;y:number;z:number;w:number}},v:number[]):number[]{
  const qp=b.principalInertiaLocalFrame() as Quat; const qe=qMul(q,qp);
  const l=new Float64Array(3); qInvRotateVec(qe,v[0]!,v[1]!,v[2]!,l);
  const I=b.principalInertia(); const o=new Float64Array(3);
  qRotateVec(qe,I.x*l[0]!,I.y*l[1]!,I.z*l[2]!,o); return [o[0]!,o[1]!,o[2]!];
}
interface Ax { axis:number[]; anchor:number[]; subs:Set<number> }
function axes(w:World,side:'l'|'r'):Ax[]{
  const out:Ax[]=[];
  for(const n of ['hip','knee','foot'] as const){const i=w.body.dofByName(`${n}_${side}`,2);const d=w.body.dofs[i]!;out.push({axis:[d.axisWorld[0]!,d.axisWorld[1]!,d.axisWorld[2]!],anchor:[d.anchorWorld[0]!,d.anchorWorld[1]!,d.anchorWorld[2]!],subs:new Set(w.body.subtree[d.joint]??[])});}
  return out;
}
function massAt(w:World,data:Ax[],pert:number,dq:number):number[][]{
  const n=3; const axis=data.map(d=>d.axis.slice()); const anchor=data.map(d=>d.anchor.slice()); const subs=data.map(d=>d.subs);
  const rot=(v:number[],q:Quat):number[]=>{const o=new Float64Array(3);qRotateVec(q,v[0]!,v[1]!,v[2]!,o);return[o[0]!,o[1]!,o[2]!]};
  const a0=anchor[pert]!; const qd=qAxisAngle(axis[pert]![0]!,axis[pert]![1]!,axis[pert]![2]!,dq);
  for(let k=pert+1;k<n;k++){const r=[anchor[k]![0]!-a0[0]!,anchor[k]![1]!-a0[1]!,anchor[k]![2]!-a0[2]!];const rr=rot(r,qd);anchor[k]=[a0[0]!+rr[0]!,a0[1]!+rr[1]!,a0[2]!+rr[2]!];axis[k]=rot(axis[k]!,qd);}
  const bp:number[][]=[],bq:Quat[]=[];
  for(let bi=0;bi<w.body.bodies.length;bi++){const b=w.body.bodies[bi]!;const p=b.worldCom();let pp=[p.x,p.y,p.z];let qq=b.rotation() as Quat;if(subs[pert]!.has(bi)){const r=[pp[0]!-a0[0]!,pp[1]!-a0[1]!,pp[2]!-a0[2]!];const rr=rot(r,qd);pp=[a0[0]!+rr[0]!,a0[1]!+rr[1]!,a0[2]!+rr[2]!];qq=qMul(qd,qq);}bp.push(pp);bq.push(qq);}
  const M=[[0,0,0],[0,0,0],[0,0,0]];
  for(let bi=0;bi<w.body.bodies.length;bi++){const b=w.body.bodies[bi]!;const m=b.mass();if(m<=0)continue;const p=bp[bi]!;const Jv:number[][]=[];for(let j=0;j<n;j++){Jv.push(subs[j]!.has(bi)?cross(axis[j]![0]!,axis[j]![1]!,axis[j]![2]!,p[0]!-anchor[j]![0]!,p[1]!-anchor[j]![1]!,p[2]!-anchor[j]![2]!):[0,0,0]);}for(let a=0;a<n;a++)for(let c=0;c<n;c++){const va=Jv[a]!,vc=Jv[c]!;M[a]![c]!+=m*(va[0]!*vc[0]!+va[1]!*vc[1]!+va[2]!*vc[2]!);if(subs[a]!.has(bi)&&subs[c]!.has(bi)){const Iu=inertiaWith(bq[bi]!,b,axis[c]!);M[a]![c]!+=axis[a]![0]!*Iu[0]!+axis[a]![1]!*Iu[1]!+axis[a]![2]!*Iu[2]!;}}}
  return M;
}
export function supportDynTorque(w:World,side:'l'|'r',qdd:number[]):number[]{
  const data=axes(w,side); const qd=[0,1,2].map(i=>w.body.dofs[w.body.dofByName(`${['hip','knee','foot'][i]}_${side}`,2)]?.vel??0);
  const M=massAt(w,data,0,0); const eps=1e-4; const dM:number[][][]=[];
  for(let j=0;j<3;j++){const Mp=massAt(w,data,j,eps),Mm=massAt(w,data,j,-eps);const d=[[0,0,0],[0,0,0],[0,0,0]];for(let a=0;a<3;a++)for(let c=0;c<3;c++)d[a]![c]!=(Mp[a]![c]!-Mm[a]![c]!)/(2*eps);dM.push(d);}
  const C=[0,0,0]; for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)C[i]!+=0.5*(dM[k]![i]![j]!+dM[j]![i]![k]!-dM[i]![j]![k]!)*qd[j]!*qd[k]!;
  return [0,1,2].map(r=>M[r]!.reduce((s,v,c)=>s+v*(qdd[c]??0),0)+C[r]!);
}
