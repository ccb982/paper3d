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
                edgeIntensity: { value: 0.8 }
            },
            vertexShader: FluidSimulator.waterVertexShader(),
            fragmentShader: FluidSimulator.waterFragmentShader(),
            transparent: true
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