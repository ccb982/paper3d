export const VAT_VERTEX_SHADER = /* glsl */ `
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
`;

export const HSL_COLOR_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uColorTex;
  uniform vec2 uTexOffset;
  uniform vec2 uTexScale;
  varying vec2 vUv;

  vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(
      abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
      0.0,
      1.0
    );
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }

  void main() {
    vec2 uv = (vUv - uTexOffset) / uTexScale;
    vec4 hsl = texture2D(uColorTex, uv) / 255.0;
    if (hsl.a < 0.5) discard;
    vec3 rgb = hsl2rgb(hsl.r, hsl.g, hsl.b);
    gl_FragColor = vec4(rgb, hsl.a);
  }
`;

export const FILL_FRAGMENT_SHADER = /* glsl */ `
  void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
`;
