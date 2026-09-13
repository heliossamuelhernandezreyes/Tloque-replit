// One pass per image layer, no bloom chain or extra WebGL context.
export const cardArtVertex = `
uniform mat3 mapTransform;
varying vec2 vUv;
varying vec2 vCardUv;
void main() {
  vUv = (mapTransform * vec3(uv, 1.0)).xy;
  vCardUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
export const cardArtFragment = `
uniform sampler2D uMap;
uniform float uFinish;
uniform float uStrength;
uniform float uOpacity;
uniform vec2 uView;
varying vec2 vUv;
varying vec2 vCardUv;
void main() {
  vec4 art = texture2D(uMap, vUv);
  if (art.a < 0.01) discard;
  vec3 result = art.rgb;
  if (uFinish > 0.5) {
    float diagonal = vCardUv.x * 0.75 + vCardUv.y * 0.55;
    float band = pow(max(0.0, 1.0 - abs(diagonal - (0.65 + uView.x * 0.28 + uView.y * 0.2)) * 3.0), 5.0);
    vec3 spectrum = 0.5 + 0.5 * cos(6.2831853 * (diagonal * 0.7 + uView.x * 0.15 + vec3(0.0, 0.33, 0.67)));
    vec3 sheen = uFinish > 1.5 ? spectrum : vec3(0.95, 0.85, 0.6);
    float grain = 0.82 + 0.18 * sin(vCardUv.x * 950.0) * sin(vCardUv.y * 950.0);
    result += sheen * band * uStrength * grain * (0.35 + result * 0.65);
  }
  gl_FragColor = vec4(result, art.a * uOpacity);
  #include <colorspace_fragment>
}`
