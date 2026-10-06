import { solveGrfQp } from '../src/core/systems/grfQp';
import { newCentroidalState } from '../src/core/centroidal';
const G=9.81, M=70;
const cs=newCentroidalState(); cs.m=M; cs.cx=0; cs.cy=0.95; cs.cz=0;
cs.Ic.fill(0); cs.Ic[0]=4; cs.Ic[4]=6; cs.Ic[8]=4; cs.dhReady=true;
const foot=(x,z,active=true)=>({x,y:0,z,copX:[x-0.14,x+0.14],copZ:[z-0.09,z+0.09],active});
const C=[foot(0,0.167),foot(0,-0.167)];
for (const ax of [0, 1.0, 4.0]) {
  const o=solveGrfQp({contacts:C,cs,aDesX:ax,aDesY:0,aDesZ:0});
  console.log(`a_des_x=${ax}`);
  for(let k=0;k<2;k++){const b=5*k;
    console.log(`  脚${k}: fx=${o.lambda[b].toFixed(2).padStart(8)} fy=${o.lambda[b+1].toFixed(2).padStart(8)}`
      +` fz=${o.lambda[b+2].toFixed(2).padStart(8)} Mzx=${o.lambda[b+3].toFixed(2).padStart(8)} Mzz=${o.lambda[b+4].toFixed(2).padStart(8)}`);}
  console.log(`  F=(${o.fTotal.map(v=>v.toFixed(1))})  resLin=${o.residual[0].toFixed(3)} resAng=${o.residual[1].toFixed(3)}`
    +`  ZMP=(${o.zmp[0].toFixed(4)},${o.zmp[1].toFixed(4)}) iters=${o.iters} checks=${JSON.stringify(o.checks)}`);
  console.log(`  LIPM 期望 ZMP_x = -(a*z/g) = ${(-(ax*0.95/G)).toFixed(4)} m`);
}
