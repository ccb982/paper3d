import * as THREE from 'three';
import { FluidSimulator, FluidParams } from '../../lib/fluid-simulator';

export class FluidSimulatorExample {
    private renderer: THREE.WebGLRenderer;
    private simulator: FluidSimulator;
    private material: THREE.ShaderMaterial;
    private mesh: THREE.Mesh;
    
    constructor(renderer: THREE.WebGLRenderer, position: THREE.Vector3, size: number = 5.0) {
        this.renderer = renderer;
        
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
        
        this.simulator = new FluidSimulator(renderer, params);
        
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
        
        const scene = this.renderer.domElement.parentElement;
        if (scene) {
            this.renderer.setClearColor(0x000000, 0);
        }
    }
    
    public addToScene(scene: THREE.Scene): void {
        scene.add(this.mesh);
    }
    
    public update(deltaTime: number): void {
        this.simulator.update(deltaTime);
        
        this.material.uniforms.phiTex.value = this.simulator.getLevelSetTexture();
        this.material.uniforms.velTex.value = this.simulator.getVelocityTexture();
        this.material.uniforms.time.value += deltaTime;
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
    
    public dispose(): void {
        this.mesh.geometry.dispose();
        this.material.dispose();
        this.simulator.dispose();
    }
}