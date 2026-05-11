import * as THREE from 'three';
import { FluidSimulator } from '@lib/fluid-simulator/fluid-simulator';
import { LightFluidEntity } from './LightFluidEntity';
import { EntityManager } from '@core/EntityManager';

export class FluidFragmentSystem {
    private simulator: FluidSimulator;
    private entityManager: EntityManager;
    private readonly TEX_SIZE = 32;
    private uvToWorld: (uv: THREE.Vector2) => THREE.Vector3;

    constructor(
        simulator: FluidSimulator,
        entityManager: EntityManager,
        uvToWorld?: (uv: THREE.Vector2) => THREE.Vector3
    ) {
        this.simulator = simulator;
        this.entityManager = entityManager;
        this.uvToWorld = uvToWorld ?? ((uv) => new THREE.Vector3(uv.x * 2 - 1, uv.y * 2 - 1, 0));
    }

    /**
     * 执行爆炸碎片分裂
     * @returns 创建的碎片实体数组
     */
    public explode(
        cx: number, cy: number, radius: number, strength: number,
        crackCount: number = 4,
        seed?: number,
        worldCenter?: THREE.Vector3
    ): LightFluidEntity[] {
        const seedVal = seed ?? Math.floor(Math.random() * 10000);
        const centerUV = new THREE.Vector2(cx, cy);
        const explosionWorldPos = worldCenter ?? this.uvToWorld(centerUV);

        // 1. 生成随机裂缝角度
        const angles = this.generateAngles(crackCount, seedVal);
        const angleWidth = 0.02;

        // 2. GPU 生成裂缝掩码
        const simWidth = this.simulator.getCurPhiTex().width;
        const simHeight = this.simulator.getCurPhiTex().height;
        const crackRT = new THREE.WebGLRenderTarget(simWidth, simHeight, {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter
        });
        this.simulator.generateCrackMaskGPU(crackRT, centerUV, angles, angleWidth, seedVal);

        // 3. 应用裂缝
        this.simulator.applyCrackMask(crackRT.texture);
        crackRT.dispose();

        // 4. 回读 phi 和 vel
        const { phi: phiData, vel: velData } = this.simulator.readPhiAndVel();

        // 5. 构建扇形区间（排序后补充闭合区间）
        const sortedAngles = [...angles].sort((a, b) => a - b);
        const fullCircle = [...sortedAngles, sortedAngles[0] + Math.PI * 2];

        const fragments: LightFluidEntity[] = [];

        // 6. 为每个扇形生成碎片
        for (let i = 0; i < fullCircle.length - 1; i++) {
            const a1 = fullCircle[i];
            const a2 = fullCircle[i + 1];

            // 提取纹理和速度场
            const { phiTex, velTex } = this.extractSectorData(phiData, velData, centerUV, a1, a2, radius);

            // 计算世界位置（扇形中点）
            const midAngle = (a1 + a2) / 2;
            const midDist = radius * 0.5;
            const uvLocal = new THREE.Vector2(
                centerUV.x + Math.cos(midAngle) * midDist,
                centerUV.y + Math.sin(midAngle) * midDist
            );
            const worldPos = this.uvToWorld(uvLocal);

            // 初速度 = 爆炸推力 + 原流场平均速度
            const baseVelocity = new THREE.Vector3(
                Math.cos(midAngle) * strength * 0.15,
                Math.sin(midAngle) * strength * 0.15,
                0
            );
            const avgVel = this.extractSectorVelocity(velData, centerUV, a1, a2, radius);
            const finalVelocity = baseVelocity.add(avgVel);

            // 创建实体
            const droplet = this.createFragmentDroplet(phiTex, velTex, worldPos, finalVelocity);
            if (droplet) {
                fragments.push(droplet);
            }
        }

        // 7. GPU 清除原纹理中的碎片区域
        const sectors = fullCircle.slice(0, -1).map((a, i) => ({
            startAngle: a,
            endAngle: fullCircle[i + 1]
        }));
        this.simulator.clearSectorRegionsGPU(centerUV, sectors, radius);

        return fragments;
    }

    /** 生成均匀但有随机偏移的裂缝角度 */
    private generateAngles(count: number, seed: number): number[] {
        const rand = this.seededRandom(seed);
        const angles: number[] = [];
        const base = rand() * Math.PI * 2;
        for (let i = 0; i < count; i++) {
            const a = base + (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.6;
            // 归化到 [0, 2π)
            angles.push(((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
        }
        return angles;
    }

    /**
     * 从回读数据中提取扇形的 phi 和 vel 纹理
     */
    private extractSectorData(
        phiData: Float32Array,
        velData: Float32Array,
        centerUV: THREE.Vector2,
        startAngle: number,
        endAngle: number,
        radius: number
    ): { phiTex: THREE.DataTexture; velTex: THREE.DataTexture } {
        const w = this.simulator.getCurPhiTex().width;
        const h = this.simulator.getCurPhiTex().height;
        const outW = this.TEX_SIZE, outH = this.TEX_SIZE;
        const phiOut = new Float32Array(outW * outH * 4);
        const velOut = new Float32Array(outW * outH * 4);

        const centerX = centerUV.x * w;
        const centerY = centerUV.y * h;
        const maxDist = radius * w * 0.95;

        for (let y = 0; y < outH; y++) {
            for (let x = 0; x < outW; x++) {
                const dx = (x - outW / 2) / (outW / 2);
                const dy = (y - outH / 2) / (outH / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);
                const idxOut = (y * outW + x) * 4;

                if (dist > 1.0) {
                    phiOut[idxOut] = 0.1;
                    velOut[idxOut] = 0; velOut[idxOut + 1] = 0;
                    continue;
                }

                // 角度规范化：统一到 [startAngle, startAngle+2π)
                let ang = Math.atan2(dy, dx);
                ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                let angTest = ang;
                if (angTest < startAngle) angTest += Math.PI * 2;

                const inSector = angTest >= startAngle && angTest < endAngle;

                // 采样大纹理
                const sampleDist = dist * maxDist;
                const sampleAngle = ang; // 采样位置仍用原始 ang（不影响位置）
                const sx = Math.floor(centerX + Math.cos(sampleAngle) * sampleDist);
                const sy = Math.floor(centerY + Math.sin(sampleAngle) * sampleDist);

                let phi = 0.1, vx = 0, vy = 0;
                if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
                    const srcIdx = (sy * w + sx) * 4;
                    phi = phiData[srcIdx];
                    vx = velData[srcIdx];
                    vy = velData[srcIdx + 1];
                }

                if (!inSector) {
                    phi = 0.1;
                    vx = 0; vy = 0;
                }

                phiOut[idxOut] = phi;
                velOut[idxOut] = vx;
                velOut[idxOut + 1] = vy;
                // 其他通道保持默认 (0,1)
            }
        }

        const phiTex = new THREE.DataTexture(phiOut, outW, outH, THREE.RGBAFormat, THREE.FloatType);
        phiTex.needsUpdate = true;
        const velTex = new THREE.DataTexture(velOut, outW, outH, THREE.RGBAFormat, THREE.FloatType);
        velTex.needsUpdate = true;

        return { phiTex, velTex };
    }

    /** 计算扇形区域的平均速度 (加权) */
    private extractSectorVelocity(
        velData: Float32Array,
        centerUV: THREE.Vector2,
        startAngle: number,
        endAngle: number,
        radius: number
    ): THREE.Vector3 {
        const w = this.simulator.getCurPhiTex().width;
        const h = this.simulator.getCurPhiTex().height;
        const centerX = centerUV.x * w;
        const centerY = centerUV.y * h;
        const maxDist = radius * w;

        let sumVx = 0, sumVy = 0, totalWeight = 0;
        const step = Math.max(1, Math.floor(w / 64));

        for (let y = 0; y < h; y += step) {
            for (let x = 0; x < w; x += step) {
                const dx = x - centerX;
                const dy = y - centerY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > maxDist) continue;

                let ang = Math.atan2(dy, dx);
                ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                let angTest = ang;
                if (angTest < startAngle) angTest += Math.PI * 2;

                if (angTest < startAngle || angTest >= endAngle) continue;

                const idx = (y * w + x) * 4;
                const vx = velData[idx];
                const vy = velData[idx + 1];
                const weight = dist;
                sumVx += vx * weight;
                sumVy += vy * weight;
                totalWeight += weight;
            }
        }

        if (totalWeight < 0.001) return new THREE.Vector3();
        return new THREE.Vector3(sumVx / totalWeight, sumVy / totalWeight, 0);
    }

    private createFragmentDroplet(
        phiTex: THREE.DataTexture,
        velTex: THREE.DataTexture,
        worldPos: THREE.Vector3,
        worldVelocity: THREE.Vector3
    ): LightFluidEntity | null {
        const renderer = this.entityManager.getRenderer();
        if (!renderer) return null;

        const droplet = new LightFluidEntity(
            `frag_${Date.now()}_${Math.random()}`,
            renderer,
            worldPos,
            worldVelocity,
            0.6,
            4.0
        );
        // 注入纹理数据
        droplet.getSimulator().setLevelSetTexture(phiTex);
        droplet.getSimulator().setVelocityTexture(velTex);
        this.entityManager.addEntity(droplet);
        return droplet;
    }

    private seededRandom(seed: number): () => number {
        let s = seed;
        return () => {
            s = Math.sin(s) * 10000;
            return s - Math.floor(s);
        };
    }
}