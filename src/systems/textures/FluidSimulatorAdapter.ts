import * as THREE from 'three';
import { FluidSimulator } from '@lib/fluid-simulator/fluid-simulator';
import type { FluidParams } from '@lib/fluid-simulator/fluid-simulator';
import type { ITextureGenerator } from './TextureManager';

export class FluidSimulatorAdapter implements ITextureGenerator {
    type: 'shader' = 'shader';
    
    private simulator: FluidSimulator;
    private material: THREE.ShaderMaterial;
    
    constructor(
        renderer: THREE.WebGLRenderer, 
        params: Partial<FluidParams> = {},
        waterColor: THREE.Color = new THREE.Color(0.2, 0.6, 0.9),
        deepColor: THREE.Color = new THREE.Color(0.05, 0.2, 0.4)
    ) {
        const defaultParams: FluidParams = {
            width: 256,
            height: 256,
            density: 1000,
            viscosity: 0.001,
            surfaceTension: 0.0728,
            gravity: 9.81,
            pressureIterations: 30,
            reinitIterations: 3,
            timeStep: 0.016,
            restitution: 0.3,
            friction: 0.95,
            ...params
        };
        
        this.simulator = new FluidSimulator(renderer, defaultParams);
        
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                phiTex: { value: null },
                velTex: { value: null },
                time: { value: 0 },
                resolution: { value: new THREE.Vector2(defaultParams.width, defaultParams.height) },
                lightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                waterColor: { value: waterColor },
                deepColor: { value: deepColor },
                edgeWidth: { value: 0.05 },
                edgeIntensity: { value: 0.3 }  // 降低边缘发光
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; vUv.y += 0.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `uniform sampler2D phiTex; uniform sampler2D velTex; uniform float time; uniform vec2 resolution; uniform vec3 lightDir; uniform vec3 waterColor; uniform vec3 deepColor; uniform float edgeWidth; uniform float edgeIntensity; varying vec2 vUv; vec3 computeNormal(vec2 uv, float eps) { float phi = texture2D(phiTex, uv).r; float phi_r = texture2D(phiTex, uv + vec2(eps, 0.0)).r; float phi_l = texture2D(phiTex, uv - vec2(eps, 0.0)).r; float phi_t = texture2D(phiTex, uv + vec2(0.0, eps)).r; float phi_b = texture2D(phiTex, uv - vec2(0.0, eps)).r; vec3 grad = vec3(phi_r - phi_l, phi_t - phi_b, 0.0); float len = length(grad); if (len < 0.001) return vec3(0.0, 0.0, 1.0); return normalize(grad); } void main() { float phi = texture2D(phiTex, vUv).r; if (phi > 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); return; } float eps = 1.0 / resolution.x; vec3 normal = computeNormal(vUv, eps); float depth = clamp(-phi * 2.0, 0.0, 1.0); vec3 baseColor = mix(waterColor, deepColor, depth); float diff = max(0.1, dot(normal, normalize(lightDir))); vec3 color = baseColor * diff; vec2 vel = texture2D(velTex, vUv).rg; float flow = length(vel) * 0.2; color += vec3(0.05, 0.1, 0.15) * flow; float edge = 1.0 - smoothstep(0.0, edgeWidth, abs(phi)); color += vec3(0.3, 0.5, 0.8) * edge * edgeIntensity; float alpha = clamp(1.0 - phi * 3.0, 0.3, 0.85); gl_FragColor = vec4(color, alpha); }`,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
    }
    
    generate(): THREE.Texture | THREE.Material {
        return this.material;
    }
    
    update(delta?: number): void {
        if (delta !== undefined) {
            this.simulator.update(delta);
        } else {
            this.simulator.update();
        }
        
        this.material.uniforms.phiTex.value = this.simulator.getLevelSetTexture();
        this.material.uniforms.velTex.value = this.simulator.getVelocityTexture();
        this.material.uniforms.time.value += delta ?? 0.016;
    }
    
    public getSimulator(): FluidSimulator {
        return this.simulator;
    }
    
    public getMaterial(): THREE.ShaderMaterial {
        return this.material;
    }
    
    public setInjectionEnabled(enabled: boolean): void {
        this.simulator.setInjectionEnabled(enabled);
    }
    
    public configureInjection(config: {
        posX?: number;
        posY?: number;
        flowRate?: number;
        velX?: number;
        velY?: number;
        size?: number;
    }): void {
        this.simulator.configureInjection(config);
    }
    
    public setSolidMaskTexture(texture: THREE.Texture): void {
        this.simulator.setSolidMaskTexture(texture);
    }
    
    dispose(): void {
        this.material.dispose();
        this.simulator.dispose();
    }
}