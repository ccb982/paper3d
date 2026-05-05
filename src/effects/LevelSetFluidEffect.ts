import { BaseEffect } from '../core/BaseEffect';
import * as THREE from 'three';
import { EntityManager } from '../core/EntityManager';
import { CameraStore } from '../core/CameraStore';
import { FluidSimulator } from '@lib/fluid-simulator';
import type { FluidParams } from '@lib/fluid-simulator';

export class LevelSetFluidEffect extends BaseEffect {
    private mesh: THREE.Mesh;
    private material: THREE.ShaderMaterial;
    private simulator: FluidSimulator;
    private position: THREE.Vector3;
    private size: number;
    
    constructor(position: THREE.Vector3, duration: number = 10.0, size: number = 5.0) {
        super(duration);
        
        this.position = position.clone();
        this.size = size;
        
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        
        const params: FluidParams = {
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
            injectionEnabled: true,
            injectionPosX: 0.5,
            injectionPosY: 0.8,
            injectionFlowRate: 2.0,
            injectionVelX: 0.0,
            injectionVelY: -2.0,
            injectionSize: 0.05
        };
        
        const renderer = EntityManager.getInstance().getRenderer();
        if (!renderer) {
            throw new Error('No renderer available');
        }
        
        this.simulator = new FluidSimulator(renderer as THREE.WebGLRenderer, params);
        
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                phiTex: { value: null },
                velTex: { value: null },
                time: { value: 0 },
                resolution: { value: new THREE.Vector2(256, 256) },
                lightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
                waterColor: { value: new THREE.Color(0.2, 0.6, 0.9) },
                deepColor: { value: new THREE.Color(0.05, 0.2, 0.4) },
                edgeWidth: { value: 0.05 },
                edgeIntensity: { value: 0.8 }
            },
            vertexShader: FluidSimulator.waterVertexShader(),
            fragmentShader: FluidSimulator.waterFragmentShader(),
            transparent: true
        });
        
        const geometry = new THREE.PlaneGeometry(size, size);
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.position.copy(position);
        this.mesh.rotation.x = -Math.PI / 2;
        
        const scene = EntityManager.getInstance().getScene();
        if (scene) scene.add(this.mesh);
    }
    
    protected onUpdate(delta: number): void {
        this.simulator.update(delta);
        
        this.material.uniforms.phiTex.value = this.simulator.getLevelSetTexture();
        this.material.uniforms.velTex.value = this.simulator.getVelocityTexture();
        this.material.uniforms.time.value += delta;
        
        const camera = CameraStore.getInstance().getCamera();
        if (camera) {
            const lookAt = new THREE.Vector3(camera.position.x, this.mesh.position.y, camera.position.z);
            this.mesh.lookAt(lookAt);
        }
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
    
    public dispose(): void {
        const scene = EntityManager.getInstance().getScene();
        if (scene && this.mesh.parent) scene.remove(this.mesh);
        
        this.mesh.geometry.dispose();
        this.material.dispose();
        this.simulator.dispose();
    }
}