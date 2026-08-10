import { forcedFixBrush, rgbToHsl, hslToRgb } from './_fix_bundle.cjs';

// 模拟"编辑器里缩放后"的另一种可能：缩放前用户手动改过 base 色（色板与区域不匹配）
// 场景：baseColors 里有 id 1-10，但缩放后 regionIdTex 只引用 id 1-4（重采样后）
const TEX = 32;
const bbox = { x: 5, y: 5, w: 22, h: 22 };
const bg = new Uint8ClampedArray(TEX*TEX*4);
for (let y=0;y<TEX;y++) for(let x=0;x<TEX;x++){
  const i=(y*TEX+x)*4;
  if(x>=5&&x<27&&y>=5&&y<27){bg[i]=100+x*5;bg[i+1]=80+y*5;bg[i+2]=150+x+y;bg[i+3]=255;}
  else{bg[i]=bg[i+1]=bg[i+2]=0;bg[i+3]=0;}
}
const paintBuffer={data:bg,width:TEX};
const w=bbox.w,h=bbox.h;

// regionIdTex 引用 id 1-4；baseColors 有 10 个（含其他帧的 5-10）
const regionIdTex = new Uint8Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)regionIdTex[y*w+x]=Math.floor(x/6)+1;
const baseColors=[];
for(let id=1;id<=10;id++){
  baseColors.push({id, h:(id%10)/10, s:0.4+id*0.03, l:0.3+id*0.03});
}
const deltaPacked=new Uint16Array(w*h);
for(let i=0;i<w*h;i++)deltaPacked[i]=((16&0x1F)<<11)|((32&0x3F)<<5)|(16&0x1F);

const result = forcedFixBrush(regionIdTex, baseColors, deltaPacked, 0n, bbox, paintBuffer, TEX, 11, 11, 8);

const colorMap=new Map(baseColors.map(c=>[c.id,c]));
let missing=0;
for(let i=0;i<regionIdTex.length;i++){
  const id=regionIdTex[i];
  if(id!==0 && !colorMap.has(id)){missing++;console.log('缺失id:',id,'@idx',i);}
}
console.log('修正后缺失 base 数:', missing, 'baseColors 总数:', baseColors.length);
console.log(missing===0?'✅ 无缺失':'❌ 有缺失(渲染黑灰)');
