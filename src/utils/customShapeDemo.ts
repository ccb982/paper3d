/**
 * 自定义子弹形状使用演示
 * 
 * 本文件展示如何将绘画网页导出的JSON形状应用到LightFluidEntity（可动子弹）
 * 
 * 使用步骤：
 * 1. 在绘画网页中绘制想要的形状（如子弹形状）
 * 2. 导出为JSON文件
 * 3. 将JSON文件放到 public/ 目录下
 * 4. 使用本文件中的方法加载并应用形状
 */

import * as THREE from 'three';
import { LightFluidEntity } from '@entities/fluid/LightFluidEntity';
import { applyShapeFromJsonFile, applyShapeFromJsonObject, createBulletWithCustomShape } from './applyCustomShape';

// ========== 示例JSON形状（子弹形状） ==========
// 从绘画网页导出的JSON数据
const BULLET_SHAPE_JSON = {
  "version": "1.2",
  "exportTime": "2026-06-09T05:30:16.430Z",
  "axis": {
    "xMin": 0,
    "xMax": 1,
    "yMin": 0,
    "yMax": 1
  },
  "grid": {
    "cols": 10,
    "rows": 10,
    "cellWidth": 0.1,
    "cellHeight": 0.1
  },
  "layers": [
    {
      "id": "layer_1",
      "displayId": 1,
      "name": "图层 1",
      "visible": true,
      "locked": false,
      "opacity": 1,
      "shapes": []
    }
  ],
  "pointAnnotations": [],
  "regionAnnotations": [
    {
      "text": "这是一个子弹的形状，很多边的那一部分是尾部",
      "polygon": [] as any,  // 实际使用时会从JSON文件加载完整数据
      "layerId": "layer_1",
      "regionId": "1",
      "id": "region_anno_1780983016432_0.123456789"
    }
  ]
};

/**
 * 演示1：创建子弹时直接使用自定义形状
 */
export async function demo1_createBulletWithCustomShape(
    renderer: THREE.WebGLRenderer
): Promise<LightFluidEntity | null> {
    console.log('=== 演示1：创建子弹时直接使用自定义形状 ===');
    
    const position = new THREE.Vector3(0, 10, 0);
    const velocity = new THREE.Vector3(0, -20, 0);
    
    // 方法1：使用便捷函数创建
    const bullet = await createBulletWithCustomShape(
        renderer,
        position,
        velocity,
        '/bullet-shape.json'  // JSON文件在public目录下
    );
    
    if (bullet) {
        console.log('✅ 成功创建自定义形状子弹');
    } else {
        console.log('❌ 创建失败，使用默认形状');
    }
    
    return bullet;
}

/**
 * 演示2：先创建子弹，再应用自定义形状
 */
export async function demo2_applyShapeToExistingBullet(
    renderer: THREE.WebGLRenderer
): Promise<LightFluidEntity> {
    console.log('=== 演示2：先创建子弹，再应用自定义形状 ===');
    
    // 步骤1：创建子弹（使用默认形状）
    const position = new THREE.Vector3(5, 10, 0);
    const velocity = new THREE.Vector3(-5, -15, 0);
    
    const bullet = new LightFluidEntity(
        'demo_bullet_2',
        renderer,
        position,
        velocity,
        0.45,  // 水量
        100    // 寿命
    );
    
    console.log('子弹已创建，当前使用默认形状');
    
    // 步骤2：应用自定义形状
    const success = await applyShapeFromJsonFile(bullet, '/bullet-shape.json');
    
    if (success) {
        console.log('✅ 成功应用自定义形状');
    } else {
        console.log('❌ 应用失败，继续使用默认形状');
    }
    
    return bullet;
}

/**
 * 演示3：使用内联JSON对象（适合形状数据较小的情况）
 */
export function demo3_useInlineJson(
    renderer: THREE.WebGLRenderer
): LightFluidEntity {
    console.log('=== 演示3：使用内联JSON对象 ===');
    
    // 创建子弹（跳过初始水量设置）
    const position = new THREE.Vector3(-5, 10, 0);
    const velocity = new THREE.Vector3(5, -15, 0);
    
    const bullet = new LightFluidEntity(
        'demo_bullet_3',
        renderer,
        position,
        velocity,
        0.45,
        100,
        true  // skipInitialVolume = true
    );
    
    // 使用内联JSON对象（这里使用简化的三角形作为示例）
    const simpleShapeJson = {
        "version": "1.2",
        "regionAnnotations": [{
            "text": "三角形子弹",
            "polygon": [[
                { "x": 0.3, "y": 0.7 },  // 左下
                { "x": 0.7, "y": 0.7 },  // 右下
                { "x": 0.5, "y": 0.2 }   // 顶部
            ]],
            "layerId": "layer_1",
            "regionId": "1",
            "id": "simple_shape"
        }]
    };
    
    const success = applyShapeFromJsonObject(bullet, simpleShapeJson);
    
    if (success) {
        console.log('✅ 成功应用内联JSON形状');
    } else {
        console.log('❌ 应用失败，使用默认形状');
        bullet.setInitialWaterVolume(0.45);
    }
    
    return bullet;
}

/**
 * 演示4：批量应用形状到多个子弹
 */
export async function demo4_batchApply(
    renderer: THREE.WebGLRenderer
): Promise<LightFluidEntity[]> {
    console.log('=== 演示4：批量应用形状到多个子弹 ===');
    
    // 创建多个子弹
    const bullets: LightFluidEntity[] = [];
    
    for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const position = new THREE.Vector3(
            Math.cos(angle) * 3,
            10,
            Math.sin(angle) * 3
        );
        const velocity = new THREE.Vector3(
            Math.cos(angle) * -5,
            -15,
            Math.sin(angle) * -5
        );
        
        const bullet = new LightFluidEntity(
            `demo_bullet_4_${i}`,
            renderer,
            position,
            velocity,
            0.45,
            100
        );
        
        bullets.push(bullet);
    }
    
    console.log(`已创建 ${bullets.length} 个子弹`);
    
    // 批量应用形状
    const { applyShapeToMultipleBullets } = await import('./applyCustomShape');
    const successCount = await applyShapeToMultipleBullets(bullets, '/bullet-shape.json');
    
    console.log(`✅ 成功应用到 ${successCount}/${bullets.length} 个子弹`);
    
    return bullets;
}

/**
 * 完整演示：运行所有示例
 */
export async function runAllDemos(
    renderer: THREE.WebGLRenderer
): Promise<void> {
    console.log('\n========================================');
    console.log('  自定义子弹形状使用演示');
    console.log('========================================\n');
    
    // 演示1
    const bullet1 = await demo1_createBulletWithCustomShape(renderer);
    
    // 演示2
    const bullet2 = await demo2_applyShapeToExistingBullet(renderer);
    
    // 演示3
    const bullet3 = demo3_useInlineJson(renderer);
    
    // 演示4
    const bullets4 = await demo4_batchApply(renderer);
    
    console.log('\n========================================');
    console.log('  所有演示完成');
    console.log('========================================\n');
    
    // 返回所有创建的子弹（可用于添加到EntityManager）
    return;
}

/**
 * 使用建议：
 * 
 * 1. 性能考虑：
 *    - JSON文件加载是异步的，建议在游戏初始化时预加载
 *    - 如果需要在运行时频繁创建子弹，可以缓存JSON对象
 * 
 * 2. 形状设计：
 *    - 在绘画网页中绘制形状时，注意形状的方向
 *    - 子弹的"尖端"应该朝上（纹理坐标系中Y值较小的一端）
 *    - 形状会自动居中并缩放到纹理大小
 * 
 * 3. 孔洞支持：
 *    - 如果形状有孔洞（如环形），绘画网页会自动识别
 *    - JSON中的polygon数组第一个是外环，后续是内环（孔洞）
 *    - polygonToLevelSet函数会正确处理孔洞
 * 
 * 4. 调试：
 *    - 打开浏览器控制台可以看到详细的加载日志
 *    - 如果形状加载失败，会自动回退到默认形状
 *    - 可以在LightFluidEntity的构造函数中设置frameCount日志频率
 */

// 导出便捷函数
export {
    applyShapeFromJsonFile,
    applyShapeFromJsonObject,
    createBulletWithCustomShape
};
