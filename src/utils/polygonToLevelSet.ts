import * as THREE from 'three';

/**
 * 多边形点接口
 */
export interface PolygonPoint {
    x: number;
    y: number;
}

/**
 * 绘画导出JSON格式
 */
export interface DrawingExportJson {
    version: string;
    exportTime: string;
    axis: {
        xMin: number;
        xMax: number;
        yMin: number;
        yMax: number;
    };
    regionAnnotations: Array<{
        text: string;
        polygon: PolygonPoint[][];  // 多环多边形，第一个是外环，后续是内环（孔洞）
        layerId: string;
        regionId: string;
        id: string;
    }>;
}

/**
 * 计算点到线段的有向距离
 * @param px 点的x坐标
 * @param py 点的y坐标
 * @param x1 线段起点x
 * @param y1 线段起点y
 * @param x2 线段终点x
 * @param y2 线段终点y
 * @returns 有向距离（正数表示在左侧，负数表示在右侧）
 */
function signedDistanceToSegment(
    px: number, py: number,
    x1: number, y1: number,
    x2: number, y2: number
): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    
    if (len2 < 1e-10) {
        // 线段退化为点
        return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    }
    
    // 投影参数 t
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    
    // 最近点
    const nearestX = x1 + t * dx;
    const nearestY = y1 + t * dy;
    
    // 距离
    const distX = px - nearestX;
    const distY = py - nearestY;
    const dist = Math.sqrt(distX * distX + distY * distY);
    
    // 有向距离：通过叉积判断左右
    const cross = dx * (py - y1) - dy * (px - x1);
    return cross >= 0 ? dist : -dist;
}

/**
 * 计算点到多边形的有向距离（Signed Distance Function）
 * @param px 点的x坐标
 * @param py 点的y坐标
 * @param polygon 多边形顶点数组（逆时针顺序）
 * @returns 有向距离（负数表示内部，正数表示外部，0表示边界）
 */
function signedDistanceToPolygon(px: number, py: number, polygon: PolygonPoint[]): number {
    if (polygon.length < 3) return 1.0;
    
    let minDist = Infinity;
    let winding = 0;
    
    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];
        
        // 计算到边的有向距离
        const dist = signedDistanceToSegment(px, py, p1.x, p1.y, p2.x, p2.y);
        minDist = Math.min(minDist, Math.abs(dist));
        
        // 计算卷绕数（判断内外）
        if (p1.y <= py) {
            if (p2.y > py) {
                // 向上穿越
                const cross = (p2.x - p1.x) * (py - p1.y) - (p2.y - p1.y) * (px - p1.x);
                if (cross > 0) winding++;
            }
        } else {
            if (p2.y <= py) {
                // 向下穿越
                const cross = (p2.x - p1.x) * (py - p1.y) - (p2.y - p1.y) * (px - p1.x);
                if (cross < 0) winding--;
            }
        }
    }
    
    // 卷绕数为0表示外部，非0表示内部
    const inside = winding !== 0;
    
    return inside ? -minDist : minDist;
}

/**
 * 计算点到多环多边形的有向距离
 * @param px 点的x坐标
 * @param py 点的y坐标
 * @param rings 多环数组（第一个是外环，后续是内环/孔洞）
 * @returns 有向距离
 */
function signedDistanceToRings(px: number, py: number, rings: PolygonPoint[][]): number {
    if (rings.length === 0) return 1.0;
    
    // 外环距离
    let dist = signedDistanceToPolygon(px, py, rings[0]);
    
    // 内环（孔洞）：在孔洞内部为正（空气），外部为负（水）
    for (let i = 1; i < rings.length; i++) {
        const holeDist = signedDistanceToPolygon(px, py, rings[i]);
        // 如果在孔洞内部（holeDist < 0），则取最大值（让该区域变为空气）
        if (holeDist < 0) {
            dist = Math.max(dist, -holeDist);
        }
    }
    
    return dist;
}

/**
 * 将多边形转换为Level Set纹理
 * @param rings 多环数组（第一个是外环，后续是内环/孔洞）
 * @param width 纹理宽度
 * @param height 纹理高度
 * @param normalize 是否归一化到纹理中心（默认true）
 * @returns THREE.DataTexture
 */
export function polygonToLevelSetTexture(
    rings: PolygonPoint[][],
    width: number,
    height: number,
    normalize: boolean = true
): THREE.DataTexture {
    const data = new Float32Array(width * height * 4);
    
    // 计算包围盒
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const ring of rings) {
        for (const p of ring) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
    }
    
    // 计算中心和缩放
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const maxDim = Math.max(sizeX, sizeY);
    const scale = 0.8 / maxDim;  // 缩放到纹理的80%大小
    
    // 生成距离场
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            
            // 纹理坐标转UV [0,1]
            const u = x / width;
            const v = y / height;
            
            // UV转多边形坐标
            let px: number, py: number;
            if (normalize) {
                // 归一化：将纹理中心映射到多边形中心，并缩放到合适大小
                px = centerX + (u - 0.5) / scale;
                py = centerY + (v - 0.5) / scale;
            } else {
                px = u;
                py = v;
            }
            
            // 计算有向距离
            const dist = signedDistanceToRings(px, py, rings);
            
            // 转换为纹理空间距离
            const phi = dist * scale;
            
            data[i] = phi;         // phi: 内部负，外部正
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 1;
        }
    }
    
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    return tex;
}

/**
 * 从绘画导出JSON中提取第一个区域注释的多边形
 * @param json 绘画导出JSON
 * @returns 多环数组，或null（如果没有区域注释）
 */
export function extractPolygonFromJson(json: DrawingExportJson): PolygonPoint[][] | null {
    if (!json.regionAnnotations || json.regionAnnotations.length === 0) {
        return null;
    }
    
    return json.regionAnnotations[0].polygon;
}

/**
 * 从JSON文件路径加载并转换为Level Set纹理
 * @param jsonPath JSON文件路径
 * @param width 纹理宽度
 * @param height 纹理高度
 * @returns Promise<THREE.DataTexture | null>
 */
export async function loadPolygonFromJson(
    jsonPath: string,
    width: number,
    height: number
): Promise<THREE.DataTexture | null> {
    try {
        const response = await fetch(jsonPath);
        const json: DrawingExportJson = await response.json();
        const rings = extractPolygonFromJson(json);
        
        if (!rings) {
            console.warn(`[polygonToLevelSet] JSON中没有找到区域注释: ${jsonPath}`);
            return null;
        }
        
        console.log(`[polygonToLevelSet] 成功加载多边形，外环${rings[0].length}点，${rings.length}个环`);
        return polygonToLevelSetTexture(rings, width, height);
    } catch (error) {
        console.error(`[polygonToLevelSet] 加载失败: ${jsonPath}`, error);
        return null;
    }
}

/**
 * 直接从JSON对象创建Level Set纹理（用于内联JSON数据）
 * @param jsonObj JSON对象
 * @param width 纹理宽度
 * @param height 纹理高度
 * @returns THREE.DataTexture | null
 */
export function createLevelSetFromJsonObj(
    jsonObj: DrawingExportJson,
    width: number,
    height: number
): THREE.DataTexture | null {
    const rings = extractPolygonFromJson(jsonObj);
    
    if (!rings) {
        console.warn('[polygonToLevelSet] JSON中没有找到区域注释');
        return null;
    }
    
    console.log(`[polygonToLevelSet] 成功创建多边形纹理，外环${rings[0].length}点，${rings.length}个环`);
    return polygonToLevelSetTexture(rings, width, height);
}
