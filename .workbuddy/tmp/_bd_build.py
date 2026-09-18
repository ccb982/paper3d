# -*- coding: utf-8 -*-
"""写 shader 与两个 HTML：
   1) 爆裂黎明_effect.glsl        —— 项目里直接用的 GLSL
   2) 爆裂黎明_特效预览.html      —— 交互预览 + 参考帧对照（放 ui页面/，相对路径能读到抠图帧）
   3) %TEMP%/bd_render.html       —— 无头 Chrome 离屏渲染 4x4 时间网格（ASCII 路径，避免命令行中文问题）
"""
import os

FRAG_BODY = r"""
precision highp float;

varying vec2 vUv;

uniform float u_time;    // 秒：0 -> u_dur
uniform float u_dur;     // 总时长（建议 0.9 ~ 1.4）
uniform float u_spikes;  // 主刺条数（实测 ~14）
uniform float u_scale;   // 整体尺寸
uniform float u_gain;    // 亮度
uniform float u_aspect;  // quad 宽/高（裁切框 1230x895 -> 1.3743）

const float TAU = 6.28318530718;

float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

// 一层尖刺：圆周 N 等分扇区，每扇区随机长度/宽度，向尖端收窄
float spikeLayer(vec2 p, float N, float lenMin, float lenMax,
                 float wMax, float seed, float spin){
  float r = length(p);
  float a = atan(p.y, p.x) + spin;
  float u = a * N / TAU;
  float i = floor(u);
  float f = abs(fract(u) * 2.0 - 1.0);        // 0=扇区中心 1=边界
  float h = hash11(i + seed * 37.0);
  float len = mix(lenMin, lenMax, h * h * 0.55 + h * 0.45);
  float rn  = r / max(len, 1e-4);
  float w0  = mix(wMax, wMax * 0.45, h);
  float w   = w0 * (1.0 - rn * 0.80);         // 越靠尖端越细
  float m   = 1.0 - smoothstep(w * 0.50, w + 0.015, f);
  m *= 1.0 - smoothstep(0.80, 1.0, rn);       // 尖端收口
  m *= smoothstep(0.0, 0.16, rn);             // 根部不要糊成一个点
  return m;
}

void main(){
  // uv 0..1 -> 居中 -1..1；乘 aspect 防非正方形 quad 拉伸
  vec2 uv = (vUv - 0.5) * 2.0;
  uv.x *= u_aspect;

  float t  = clamp(u_time, 0.0, u_dur);
  float tn = t / u_dur;

  // ---- 时间：起爆极快（实测 #3 还几乎为 0，#4 就冲顶），之后单一时间常数衰减 ----
  // 实测 16 帧红度覆盖（已扣掉 ~1.8% 的背景红底噪）归一到峰值：
  //   #4 1.0 -> #5 .61 -> #6 .63 -> #7 .53 -> #8 .32 -> #9 .34 -> 之后 ≈0
  //   exp(-d/0.30) 刚好穿过这一串（d = tn - 0.19）
  float grow  = 1.0 - exp(-t * 18.0);                     // 半径生长
  float rise  = smoothstep(0.155, 0.205, tn);             // 起爆窗口很窄
  float d     = max(0.0, tn - 0.19);
  float amp   = rise * exp(-d / 0.24);

  vec2  p = uv / max(u_scale, 1e-3);
  float r = length(p);
  float N = u_spikes;

  // ---- 1) 主体光球 = 小热核（尖峰型）+ 宽裙（低幅平台型）----
  // 关键：宽裙的幅度刻意压在 pct150 阈值以下（0.30 对应 ~122 < 150），
  // 这样它只贡献 pct60 的"大面积"，不贡献高红区 —— 实测 pct150/pct60≈0.18 才能对上。
  // 尖峰型单独用的最低比值是 0.39；纯平台型更差（0.5+）。
  float cusp  = exp(-pow(r / 0.36, 0.78));
  float skirt = pow(max(0.0, 1.0 - r / 1.65), 0.75);
  float glow  = 0.84 * cusp + 0.16 * skirt;

  // ---- 2) 三层尖刺（主刺 / 细刺 / 长针）----
  float sp1 = spikeLayer(p / (0.55 + 0.55 * grow), N,             0.85, 1.70, 0.075,  3.0,  t * 0.10);
  float sp2 = spikeLayer(p / (0.35 + 0.75 * grow), N * 1.6 + 3.0, 0.60, 1.35, 0.045, 11.0, -t * 0.20);
  float sp3 = spikeLayer(p / (1.10 + 0.30 * grow), N * 0.5 + 1.0, 1.10, 1.95, 0.038, 23.0,  t * 0.05)
            * (1.0 - smoothstep(0.10, 0.45, tn));       // 长针只在早期

  // ---- 3) 内芯（别做过曝白，实测核心仍是饱和红 ~ (231,55,56)）----
  float core = exp(-dot(p, p) / (0.035 + 0.06 * tn));

  // ---- 配色（实测：外围暗红 -> 主体饱和红 -> 内芯只微微提亮）----
  vec3 cOut  = vec3(0.60, 0.040, 0.050);
  vec3 cRed  = vec3(0.95, 0.110, 0.100);
  vec3 cCore = vec3(1.00, 0.260, 0.240);
  vec3 body  = mix(cRed, cOut, clamp(r / 1.10, 0.0, 1.0));

  vec3 col = vec3(0.0);
  col += body  * glow * amp * 1.30;
  col += cRed  * (sp1 * 0.45 + sp2 * 0.25) * amp;
  col += mix(cCore, cRed, 0.45) * sp3 * amp * 0.45;
  col += cCore * core * amp * 0.55;
  col *= u_gain;

  // 加色混合：alpha 恒 1，靠 rgb 叠加
  gl_FragColor = vec4(col, 1.0);
}
"""

VERT = r"""
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
"""

GLSL_FILE = r'''// ============================================================================
// 爆裂黎明 · 起爆特效（Blazing Dawn）
// ----------------------------------------------------------------------------
// 参数是从用户实测 16 帧截图里量出来的（红度 R-max(G,B)）：
//   · 时间轴：起爆极快，峰值在生命周期的约 0.19 处，之后衰减，尾巴很长
//             （红度覆盖 归一到峰值：.05 .06 .04 [1.0] .57 .60 .46 .12 .15
//              .08 .08 .10 .06 .13 .09 .04）
//   · 径向：小热核 + 宽裙。热核用尖峰型 exp(-(r/0.36)^0.78)，
//           宽裙用低幅平台型 pow(1-r/1.65, 0.75) 压到 pct150 阈值以下。
//           ★ 只用平台型的话"高红区"太大（实测 pct150/pct60≈0.18，平台型最低 ~0.39）
//   · 尖刺：外圈角向 ~14 个瓣，细长，尖端伸到主体半径的 ~1.7 倍
//   · 配色：外围暗红 (0.60,0.04,0.05) -> 主体饱和红 (0.95,0.11,0.10)
//           -> 内芯只微微提亮 (1.00,0.26,0.24)
//           实测 hot_rgb≈(221,36,35)、核心≈(231,55,56) —— 核心不是白热，别做过曝
//
// 拟合结果（无头 Chrome 离屏渲染后与参考帧逐项量，见 爆裂黎明_shader对比.jpg）：
//   pct60 峰值  35.25(参考) vs 37.0(shader)
//   pct150 峰值 6.29(参考)  vs 8.6(shader)
//   径向轮廓相关 0.94        hot_rgb (221,36,35) vs (225,36,33)
//
// 用法：贴在一个正对相机的 quad（billboard）上，加色混合，depthWrite = false
//
//   const mat = new THREE.ShaderMaterial({
//     uniforms: {
//       u_time:   { value: 0 },        // 秒
//       u_dur:    { value: 1.10 },     // 总时长
//       u_spikes: { value: 14.0 },     // 主刺条数
//       u_scale:  { value: 1.00 },     // 整体大小（原图裁切框对齐 1.0）
//       u_gain:   { value: 1.30 },     // 亮度
//       u_aspect: { value: 1230/895 }, // quad 宽/高
//     },
//     vertexShader:   VERT,
//     fragmentShader: FRAG,
//     transparent: true,
//     blending: THREE.AdditiveBlending,
//     depthWrite: false,
//     depthTest: false,
//   });
//
// 注意：uv 空间里 r=1 等于 quad 半高；实测主体 r95≈0.84、尖刺尖端≈1.4~1.76，
//       所以尖刺本来就会被 quad 边缘裁掉 —— 和原截图里被裁掉的情况一致。
// ============================================================================


// ---------------------------------------------------------------- vertex ---
export const VERT = /* glsl */`%s`;


// -------------------------------------------------------------- fragment ---
export const FRAG = /* glsl */`%s`;
''' % (VERT, FRAG_BODY)


def head(title, extra_css=''):
    return '''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>%s</title>
<style>
  html,body{margin:0;padding:0;background:#07070a;color:#ddd;
    font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}
  %s
</style></head><body>
''' % (title, extra_css)


SHADER_JS = '''
const FRAG = `%s`;
// 裸 WebGL 用的顶点着色器（Three.js 那份用内建 uv/position，这里不行）
const VERT = `
attribute vec2 a_pos;
varying vec2 vUv;
void main(){
  vUv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

function compile(gl, type, src){
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function makeGL(canvas){
  const gl = canvas.getContext('webgl2', {alpha:true, premultipliedAlpha:false, preserveDrawingBuffer:true})
          || canvas.getContext('webgl',  {alpha:true, premultipliedAlpha:false, preserveDrawingBuffer:true});
  if(!gl) throw new Error('no webgl');
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, 'a_pos');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return {gl, p};
}
function setU(gl, p, o){
  for(const k in o){ const l = gl.getUniformLocation(p, k); if(l) gl.uniform1f(l, o[k]); }
}
''' % (FRAG_BODY,)

# ---------------------------------------------------------------- render page
RENDER = head('bd render') + '<canvas id="c"></canvas>\n<pre id="diag"></pre>\n<script>' + SHADER_JS + '''
const diag = [];
const log = m => { diag.push(m); document.getElementById('diag').textContent = diag.join('\\n'); };
window.onerror = (m,s,l,c,e) => log('JS ERROR: '+m+' @'+l+':'+c);
const COLS = 4, ROWS = 4, TW = 492, TH = 358;
const DUR = 1.10;
try{
  const canvas = document.getElementById('c');
  canvas.width = COLS*TW; canvas.height = ROWS*TH;
  canvas.style.width = canvas.width+'px'; canvas.style.height = canvas.height+'px';
  const ctx = canvas.getContext('2d');

  const scratch = document.createElement('canvas');
  scratch.width = TW; scratch.height = TH;
  const {gl, p} = makeGL(scratch);
  log('GL_VERSION: ' + gl.getParameter(gl.VERSION));
  log('RENDERER  : ' + gl.getParameter(gl.RENDERER));

  for(let i=0;i<COLS*ROWS;i++){
    const t = (i/(COLS*ROWS-1)) * DUR;
    gl.viewport(0,0,TW,TH);
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    setU(gl, p, {u_time:t, u_dur:DUR, u_spikes:14.0, u_scale:1.0, u_gain:1.30, u_aspect:1230/895});
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const x = (i%COLS)*TW, y = ((i/COLS)|0)*TH;
    ctx.drawImage(scratch, x, y);
    ctx.strokeStyle='#2a2a30'; ctx.strokeRect(x+.5,y+.5,TW-1,TH-1);
    ctx.fillStyle='#ffe066'; ctx.font='16px monospace';
    ctx.fillText('#'+(i+1)+'  t='+t.toFixed(2)+'s', x+10, y+24);
    const px = new Uint8Array(4);
    gl.readPixels((TW/2)|0, (TH/2)|0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if(i<4 || i===15) log('tile'+(i+1)+' t='+t.toFixed(2)+' center px='+px[0]+','+px[1]+','+px[2]);
  }
  const img = ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let nz=0, mx=0, sr=0;
  for(let i=0;i<img.length;i+=4){
    const v = Math.max(img[i],img[i+1],img[i+2]);
    if(v>12) nz++;
    if(v>mx) mx=v;
    sr += img[i];
  }
  log('非黑像素占比: '+(100*nz/(img.length/4)).toFixed(3)+'%  最大亮度: '+mx+'  R均值: '+(sr/(img.length/4)).toFixed(2));
  log('DONE');
}catch(e){ log('EXCEPTION: '+(e && e.message ? e.message : e)); }
document.title = 'ready';
</script></body></html>
'''

# ------------------------------------------------------------- preview page
PREVIEW = head('爆裂黎明 · 特效预览', '''
  #wrap{display:flex;gap:18px;padding:16px;flex-wrap:wrap}
  #left{flex:0 0 auto}
  canvas#main{background:#000;border:1px solid #26262c;border-radius:3px;display:block}
  #right{flex:1 1 420px;min-width:420px}
  .row{display:flex;align-items:center;gap:8px;margin:6px 0}
  .row label{width:86px;color:#9aa}
  input[type=range]{flex:1}
  .val{width:56px;text-align:right;color:#ffe066;font-variant-numeric:tabular-nums}
  #strip{display:flex;flex-wrap:wrap;gap:4px;margin-top:10px}
  #strip img{width:74px;border:1px solid #333;cursor:pointer;border-radius:2px}
  #strip img.on{border-color:#ffe066;box-shadow:0 0 0 1px #ffe066}
  #ref{width:100%;max-width:492px;border:1px solid #26262c;border-radius:3px;background:#000}
  .cap{color:#889;margin:10px 0 4px}
  button{background:#1d1d22;color:#ddd;border:1px solid #3a3a44;padding:5px 10px;border-radius:3px;cursor:pointer}
  button:hover{border-color:#ffe066}
''') + '''
<div id="wrap">
  <div id="left">
    <canvas id="main" width="615" height="447"></canvas>
    <div class="cap">上面 = shader 渲染；下面 = 参考帧（已去背景）</div>
    <img id="ref" alt="reference">
  </div>
  <div id="right">
    <div class="row"><label>时间 t</label><input id="t" type="range" min="0" max="1.1" step="0.005" value="0"><span class="val" id="tv">0.00</span></div>
    <div class="row"><label>总时长</label><input id="dur" type="range" min="0.4" max="2.5" step="0.01" value="1.1"><span class="val" id="durv">1.10</span></div>
    <div class="row"><label>主刺条数</label><input id="sp" type="range" min="4" max="48" step="1" value="14"><span class="val" id="spv">14</span></div>
    <div class="row"><label>尺寸</label><input id="sc" type="range" min="0.3" max="2.2" step="0.01" value="1"><span class="val" id="scv">1.00</span></div>
    <div class="row"><label>亮度</label><input id="gn" type="range" min="0.2" max="3" step="0.01" value="1.30"><span class="val" id="gnv">1.30</span></div>
    <div class="row"><button id="play">▶ 播放</button><button id="reset">复位</button>
      <button id="bg">背景：黑 / 棋盘</button></div>
    <div class="cap">参考帧（点一下 → shader 跳到对应进度）</div>
    <div id="strip"></div>
  </div>
</div>
<div id="err" style="color:#f66;padding:0 16px"></div>
<script>''' + SHADER_JS + '''
const N = 16, DUR0 = 1.10;
const cv = document.getElementById('main');
cv.width = 615; cv.height = 447;
const {gl, p} = makeGL(cv);
let t = 0, playing = false, checker = false, last = 0;

const bgc = document.createElement('canvas'); bgc.width=bgc.height=2;
const bgx = bgc.getContext('2d');
bgx.fillStyle='#000'; bgx.fillRect(0,0,1,1);
bgx.fillStyle='#141418'; bgx.fillRect(1,1,1,1);

function draw(){
  gl.viewport(0,0,cv.width,cv.height);
  gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  cv.style.backgroundImage = checker
    ? 'repeating-conic-gradient(#141418 0 25%, #000 0 50%)' : 'none';
  cv.style.backgroundSize = '24px 24px';
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  setU(gl, p, {u_time:t, u_dur:+dur.value, u_spikes:+sp.value, u_scale:+sc.value,
               u_gain:+gn.value, u_aspect:1230/895});
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  tv.textContent = t.toFixed(2);
}
function loop(ts){
  if(playing){
    if(!last) last = ts;
    t += (ts - last)/1000; last = ts;
    if(t > +dur.value) t = 0;
    document.getElementById('t').value = t; draw();
  } else last = 0;
  requestAnimationFrame(loop);
}
function pickRef(i){
  document.getElementById('ref').src = '爆裂黎明_按序/抠图/' + String(i).padStart(2,'0') + '.png';
  t = (i-1)/(N-1) * +dur.value;
  document.getElementById('t').value = t; draw();
  document.querySelectorAll('#strip img').forEach((im,k)=>im.classList.toggle('on', k===i-1));
}
const strip = document.getElementById('strip');
for(let i=1;i<=N;i++){
  const im = document.createElement('img');
  im.src = '爆裂黎明_按序/预览/' + String(i).padStart(2,'0') + '.jpg';
  im.onclick = ()=>pickRef(i);
  strip.appendChild(im);
}
t.addEventListener('input', ()=>{ t = +t.value; draw(); });
['dur','sp','sc','gn'].forEach(id=>document.getElementById(id).addEventListener('input', e=>{
  document.getElementById(id+'v').textContent = (+e.target.value).toFixed(id==='sp'?0:2); draw();
}));
play.onclick = ()=>{ playing = !playing; play.textContent = playing ? '⏸ 暂停' : '▶ 播放'; };
reset.onclick = ()=>{ t=0; dur.value=1.1; sp.value=14; sc.value=1; gn.value=1.30;
  durv.textContent='1.10'; spv.textContent='14'; scv.textContent='1.00'; gnv.textContent='1.30'; draw(); };
bg.onclick = ()=>{ checker = !checker; draw(); };
try{ pickRef(1); requestAnimationFrame(loop); }catch(e){ document.getElementById('err').textContent = 'WebGL 出错: '+e.message; }
</script></body></html>
'''

UI = r'C:\Users\22641\Desktop\游戏素材\ui页面'
TMP = os.path.join(os.environ['TEMP'], 'bd_render.html')
for path, txt, enc in [(os.path.join(UI, '爆裂黎明_effect.glsl'), GLSL_FILE, 'utf-8'),
                       (os.path.join(UI, '爆裂黎明_特效预览.html'), PREVIEW, 'utf-8'),
                       (TMP, RENDER, 'utf-8')]:
    open(path, 'w', encoding=enc).write(txt)
    print('写入 %-52s %7.1f KB' % (path, os.path.getsize(path) / 1024))
