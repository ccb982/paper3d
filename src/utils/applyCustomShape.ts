/**
 * 使用示例：将绘画导出的JSON形状应用到LightFluidEntity（可动子弹）
 * 
 * 使用方法：
 * 1. 在绘画网页中绘制想要的形状
 * 2. 导出为JSON文件
 * 3. 使用本模块的函数加载并应用到子弹实体
 */

import * as THREE from 'three';
import type { LightFluidEntity } from '@entities/fluid/LightFluidEntity';
import type { DrawingExportJson } from './polygonToLevelSet';

/**
 * 示例1：从JSON文件路径加载形状并应用到子弹
 * 
 * @param bullet 子弹实体
 * @param jsonPath JSON文件路径（相对于public目录或绝对URL）
 * 
 * @example
 * ```typescript
 * const bullet = new LightFluidEntity('bullet1', renderer, position, velocity);
 * await applyShapeFromJsonFile(bullet, '/assets/bullet-shape.json');
 * ```
 */
export async function applyShapeFromJsonFile(
    bullet: LightFluidEntity,
    jsonPath: string
): Promise<boolean> {
    try {
        const response = await fetch(jsonPath);
        if (!response.ok) {
            console.error(`[applyShapeFromJsonFile] 加载失败: ${jsonPath}, status: ${response.status}`);
            return false;
        }
        
        const json: DrawingExportJson = await response.json();
        return bullet.setShapeFromDrawingJson(json);
    } catch (error) {
        console.error(`[applyShapeFromJsonFile] 加载失败: ${jsonPath}`, error);
        return false;
    }
}

/**
 * 示例2：从内联JSON对象应用形状
 * 
 * @param bullet 子弹实体
 * @param jsonObj JSON对象（可以直接粘贴绘画导出的JSON内容）
 * 
 * @example
 * ```typescript
 * const bullet = new LightFluidEntity('bullet1', renderer, position, velocity);
 * 
 * // 直接粘贴从绘画网页导出的JSON内容
 * const shapeJson = {
 *   "version": "1.2",
 *   "regionAnnotations": [{
 *     "polygon": [[
 *       { "x": 0.3, "y": 0.5 },
 *       { "x": 0.7, "y": 0.5 },
 *       { "x": 0.5, "y": 0.2 }
 *     ]]
 *   }]
 * };
 * 
 * applyShapeFromJsonObject(bullet, shapeJson);
 * ```
 */
export function applyShapeFromJsonObject(
    bullet: LightFluidEntity,
    jsonObj: DrawingExportJson
): boolean {
    return bullet.setShapeFromDrawingJson(jsonObj);
}

/**
 * 示例3：批量应用到多个子弹
 * 
 * @param bullets 子弹实体数组
 * @param jsonPath JSON文件路径
 * 
 * @example
 * ```typescript
 * const bullets = [
 *   new LightFluidEntity('bullet1', renderer, pos1, vel1),
 *   new LightFluidEntity('bullet2', renderer, pos2, vel2),
 *   new LightFluidEntity('bullet3', renderer, pos3, vel3),
 * ];
 * 
 * await applyShapeToMultipleBullets(bullets, '/assets/bullet-shape.json');
 * ```
 */
export async function applyShapeToMultipleBullets(
    bullets: LightFluidEntity[],
    jsonPath: string
): Promise<number> {
    try {
        const response = await fetch(jsonPath);
        if (!response.ok) {
            console.error(`[applyShapeToMultipleBullets] 加载失败: ${jsonPath}`);
            return 0;
        }
        
        const json: DrawingExportJson = await response.json();
        let successCount = 0;
        
        for (const bullet of bullets) {
            if (bullet.setShapeFromDrawingJson(json)) {
                successCount++;
            }
        }
        
        console.log(`[applyShapeToMultipleBullets] 成功应用到 ${successCount}/${bullets.length} 个子弹`);
        return successCount;
    } catch (error) {
        console.error(`[applyShapeToMultipleBullets] 加载失败: ${jsonPath}`, error);
        return 0;
    }
}

/**
 * 示例4：在创建子弹时直接使用自定义形状
 * 
 * @param renderer WebGL渲染器
 * @param position 初始位置
 * @param velocity 初始速度
 * @param jsonPath JSON文件路径
 * 
 * @example
 * ```typescript
 * const bullet = await createBulletWithCustomShape(
 *   renderer,
 *   new THREE.Vector3(0, 10, 0),
 *   new THREE.Vector3(0, -20, 0),
 *   '/assets/bullet-shape.json'
 * );
 * ```
 */
export async function createBulletWithCustomShape(
    renderer: THREE.WebGLRenderer,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    jsonPath: string
): Promise<LightFluidEntity | null> {
    // 动态导入避免循环依赖
    const { LightFluidEntity } = await import('@entities/fluid/LightFluidEntity');
    
    // 创建子弹（跳过初始水量设置）
    const bullet = new LightFluidEntity(
        `bullet_${Date.now()}`,
        renderer,
        position,
        velocity,
        0.45,
        100,
        true  // skipInitialVolume = true，稍后设置自定义形状
    );
    
    // 应用自定义形状
    const success = await applyShapeFromJsonFile(bullet, jsonPath);
    
    if (!success) {
        console.warn('[createBulletWithCustomShape] 自定义形状加载失败，使用默认形状');
        bullet.setInitialWaterVolume(0.45);
    }
    
    return bullet;
}
