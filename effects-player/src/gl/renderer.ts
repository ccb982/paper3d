import * as THREE from 'three';
import earcut from 'earcut';
import type { SerializedRegionEntity } from '../core/types';

export interface EntityMeshData {
  entity: SerializedRegionEntity;
  mesh: THREE.Mesh;
  fillMesh: THREE.Mesh;
  displacementTexture: THREE.DataTexture;
  vertexCount: number;
  totalFrames: number;
  texBbox: { x: number; y: number; w: number; h: number };
  frameWidth: number;
}

function triangulateBoundary(
  boundary: [number, number][][],
): { positions: Float32Array; uvs: Float32Array; indices: number[]; vertexCount: number } | null {
  const flatVertices: number[] = [];
  const holeIndices: number[] = [];
  let totalVertexCount = 0;

  for (let ringIdx = 0; ringIdx < boundary.length; ringIdx++) {
    const ring = boundary[ringIdx];
    if (ringIdx > 0) holeIndices.push(totalVertexCount);
    for (const v of ring) {
      flatVertices.push(v[0], v[1]);
      totalVertexCount++;
    }
  }

  if (totalVertexCount < 3) return null;
  for (const fv of flatVertices) {
    if (!isFinite(fv)) return null;
  }

  const positions = new Float32Array(flatVertices);

  let indices: number[];
  try {
    const result = earcut(flatVertices, holeIndices.length > 0 ? holeIndices : undefined, 2);
    indices = Array.from(result).filter((i) => i >= 0 && i < totalVertexCount);
    if (indices.length < 3) throw new Error('earcut returned too few indices');
  } catch {
    if (boundary[0].length < 3) return null;
    indices = [];
    for (let i = 1; i < boundary[0].length - 1; i++) indices.push(0, i, i + 1);
  }

  const uvs = new Float32Array(totalVertexCount * 2);
  for (let i = 0; i < totalVertexCount; i++) {
    uvs[i * 2] = positions[i * 2];
    uvs[i * 2 + 1] = 1 - positions[i * 2 + 1];
  }

  return { positions, uvs, indices, vertexCount: totalVertexCount };
}

function makeFillMaterial(displacementTexture: THREE.DataTexture, vertexCount: number, totalFrames: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform sampler2D uDisplacementTex;
      uniform float uTime;
      uniform float uFramesPerSecond;
      uniform float uTotalFrames;
      uniform float uVertexCount;
      varying vec2 vUv;
      void main() {
        float frame = mod(uTime * uFramesPerSecond, uTotalFrames);
        float texY = frame / uTotalFrames;
        float texX = (float(gl_VertexID) + 0.5) / uVertexCount;
        vec2 displacement = texture2D(uDisplacementTex, vec2(texX, texY)).rg;
        vUv = uv;
        vec3 pos = position + vec3(displacement, 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `void main() { gl_FragColor = vec4(0.0); }`,
    uniforms: {
      uDisplacementTex: { value: displacementTexture },
      uTime: { value: 0 },
      uFramesPerSecond: { value: 30 },
      uTotalFrames: { value: totalFrames },
      uVertexCount: { value: vertexCount },
    },
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilZPass: THREE.InvertStencilOp,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilRef: 0,
    stencilWriteMask: 0xFF,
    stencilFuncMask: 0xFF,
  });
}

function makeColorMaterial(displacementTexture: THREE.DataTexture, vertexCount: number, totalFrames: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform sampler2D uDisplacementTex;
      uniform float uTime;
      uniform float uFramesPerSecond;
      uniform float uTotalFrames;
      uniform float uVertexCount;
      varying vec2 vUv;
      void main() {
        float frame = mod(uTime * uFramesPerSecond, uTotalFrames);
        float texY = frame / uTotalFrames;
        float texX = (float(gl_VertexID) + 0.5) / uVertexCount;
        vec2 displacement = texture2D(uDisplacementTex, vec2(texX, texY)).rg;
        vUv = uv;
        vec3 pos = position + vec3(displacement, 0.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uBaseTexture;
      uniform sampler2D uResidual;
      uniform vec2 uTexOffset;
      uniform vec2 uTexScale;
      varying vec2 vUv;
      vec3 hsl2rgb(float h, float s, float l) {
        vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
      }
      void main() {
        vec2 uv = (vUv - uTexOffset) / uTexScale;
        vec4 base = texture2D(uBaseTexture, uv);
        if (base.a < 0.5) discard;
        vec4 res = texture2D(uResidual, uv);
        // 残差统一 0.5 范围：d = (val*2-1)*0.5
        float dH = (res.r * 2.0 - 1.0) * 0.5;
        float dS = (res.g * 2.0 - 1.0) * 0.5;
        float dL = (res.b * 2.0 - 1.0) * 0.5;
        float finalH = fract(base.r + dH);
        float finalS = clamp(base.g + dS, 0.0, 1.0);
        float finalL = clamp(base.b + dL, 0.0, 1.0);
        vec3 rgb = hsl2rgb(finalH, finalS, finalL);
        gl_FragColor = vec4(rgb, base.a);
      }
    `,
    uniforms: {
      uDisplacementTex: { value: displacementTexture },
      uTime: { value: 0 },
      uFramesPerSecond: { value: 30 },
      uTotalFrames: { value: totalFrames },
      uVertexCount: { value: vertexCount },
      uBaseTexture: { value: null },
      uResidual: { value: null },
      uTexOffset: { value: new THREE.Vector2() },
      uTexScale: { value: new THREE.Vector2() },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: false,
    stencilFunc: THREE.EqualStencilFunc,
    stencilRef: 1,
    stencilFuncMask: 0xFF,
  });
}

export function buildEntityMesh(
  entity: SerializedRegionEntity,
  ftxBbox: { x: number; y: number; w: number; h: number },
  displacementTexture: THREE.DataTexture,
  vertexCount: number,
  totalFrames: number,
  canvasSize: number,
): EntityMeshData | null {
  const boundary = entity.boundary.map((ring) =>
    ring.map((p) => [p.x, p.y] as [number, number]),
  );

  const tri = triangulateBoundary(boundary);
  if (!tri) return null;

  const { positions, uvs, indices, vertexCount: vc } = tri;

  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.BufferAttribute(positions, 2));
  fillGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  fillGeo.setIndex(indices);
  fillGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, 0), 1);
  fillGeo.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, -0.01), new THREE.Vector3(1, 1, 0.01));

  const fillMat = makeFillMaterial(displacementTexture, vc, totalFrames);
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.frustumCulled = false;

  const colorGeo = new THREE.BufferGeometry();
  colorGeo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 2));
  colorGeo.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(), 2));
  colorGeo.setIndex([...indices]);
  colorGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, 0), 1);
  colorGeo.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, -0.01), new THREE.Vector3(1, 1, 0.01));

  const colorMat = makeColorMaterial(displacementTexture, vc, totalFrames);
  const mesh = new THREE.Mesh(colorGeo, colorMat);
  mesh.frustumCulled = false;

  return {
    entity,
    mesh,
    fillMesh,
    displacementTexture,
    vertexCount: vc,
    totalFrames,
    texBbox: ftxBbox,
    frameWidth: canvasSize,
  };
}

export function renderFrameData(
  data: { baseTexture: THREE.DataTexture; residualTexture: THREE.DataTexture; entities: EntityMeshData[] },
  animationTime: number,
  vatFps: number,
  transform: { position: { x: number; y: number; z: number }; scale: { x: number; y: number }; rotation: number },
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
): void {
  if (data.entities.length === 0) return;

  const gl = renderer.getContext();
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;

  gl.enable(gl.STENCIL_TEST);
  gl.clearStencil(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

  const { position, scale, rotation } = transform;

  for (const em of data.entities) {
    const fm = em.fillMesh.material as THREE.ShaderMaterial;
    fm.uniforms.uTime.value = animationTime;
    fm.uniforms.uFramesPerSecond.value = vatFps;
    em.fillMesh.position.set(position.x, position.y, position.z);
    em.fillMesh.scale.set(scale.x, scale.y, 1);
    em.fillMesh.rotation.z = rotation;
    scene.add(em.fillMesh);
    renderer.render(scene, camera);
    scene.remove(em.fillMesh);
  }

  for (const em of data.entities) {
    const cm = em.mesh.material as THREE.ShaderMaterial;
    cm.uniforms.uTime.value = animationTime;
    cm.uniforms.uFramesPerSecond.value = vatFps;
    cm.uniforms.uBaseTexture.value = data.baseTexture;
    cm.uniforms.uResidual.value = data.residualTexture;
    (cm.uniforms.uTexOffset.value as THREE.Vector2).set(em.texBbox.x / em.frameWidth, em.texBbox.y / em.frameWidth);
    (cm.uniforms.uTexScale.value as THREE.Vector2).set(em.texBbox.w / em.frameWidth, em.texBbox.h / em.frameWidth);
    em.mesh.position.set(position.x, position.y, position.z);
    em.mesh.scale.set(scale.x, scale.y, 1);
    em.mesh.rotation.z = rotation;
    scene.add(em.mesh);
    renderer.render(scene, camera);
    scene.remove(em.mesh);
  }

  renderer.autoClear = autoClear;
  gl.disable(gl.STENCIL_TEST);
}

export function createThreeContext(sizeOrCanvas?: number | HTMLCanvasElement): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
} {
  const size = typeof sizeOrCanvas === 'number' ? sizeOrCanvas : 512;
  const canvas = sizeOrCanvas instanceof HTMLCanvasElement ? sizeOrCanvas : undefined;

  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: true, stencil: true, antialias: true, preserveDrawingBuffer: false,
  });
  renderer.setSize(size, size);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

  return { renderer, scene, camera };
}
