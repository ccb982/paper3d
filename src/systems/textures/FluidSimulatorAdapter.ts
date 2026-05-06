import * as THREE from 'three';
import { FluidSimulator } from '@lib/fluid-simulator/fluid-simulator';
import type { FluidParams } from '@lib/fluid-simulator/fluid-simulator';
import type { ITextureGenerator } from './TextureManager';

export class FluidSimulatorAdapter implements ITextureGenerator {
    type: 'shader' = 'shader';

    private simulator: FluidSimulator;
    private material: THREE.ShaderMaterial;
    private lastUpdateTime: number = 0;
    private updateInterval: number = 16;

    constructor(
        renderer: THREE.WebGLRenderer,
        params: Partial<FluidParams> = {}
    ) {
        // 默认参数，包含分层渲染配置
        const defaultParams: FluidParams = {
            width: 256,
            height: 256,
            density: 1000,
            viscosity: 0.001,
            surfaceTension: 0.0728,
            gravity: 9.81,
            pressureIterations: 20,
            reinitIterations: 5,
            timeStep: 0.002,
            restitution: 0.3,
            friction: 0.95,
            usePCG: true,
            // 分层渲染参数
            waterColor: new THREE.Color(0.2, 0.6, 0.9),
            deepColor: new THREE.Color(0.05, 0.2, 0.4),
            edgeWidth: 0.05,
            edgeIntensity: 0.3,
            specularIntensity: 0.5,
            flowIntensity: 0.3,
            lightDir: new THREE.Vector3(0.5, 1.0, 0.3).normalize(),
            ...params
        };
        
        // 创建模拟器，传入完整参数（包括分层渲染配置）
        this.simulator = new FluidSimulator(renderer, defaultParams);
        
        // 使用 FluidSimulator 内置的分层渲染材质
        this.material = this.simulator.getRenderMaterial();
        
        // 调试录制已禁用
        // this.simulator.enableDebugRecording(true, 10);
    }
    
    generate(): THREE.Texture | THREE.Material {
        return this.material;
    }
    
    update(delta?: number): void {
        const now = performance.now();
        if (now - this.lastUpdateTime < this.updateInterval) {
            return;
        }
        this.lastUpdateTime = now;

        if (delta !== undefined) {
            this.simulator.update(delta);
        } else {
            this.simulator.update();
        }

        this.simulator.updateRenderUniforms();
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
        // material 是从 simulator 获取的引用，由 simulator.dispose() 统一释放
        this.simulator.dispose();
    }
}