import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { FrameData } from '../types';
import type { RegionEntity } from '../core/RegionEntity';
import { FluidSolver, defaultFluidConfig, type FluidSolverConfig } from './FluidSolver';
import { buildBaseHslFromFrame, rasterizeBoundaryToObstacle, buildObstacleTextureFromBitmask, resolveFluidResolution } from './fluidIntegration';

// ============================================================
// useFluidSolver —— FluidSolver 生命周期 hook
// ============================================================
//
// 职责：
//   1. 当 frameData.fluidConfig 存在且区域已绑定纹理时，创建 FluidSolver：
//      - 残差（boundResidualTexture）→ colorGrid（★流体直接作用在残差上）
//      - 反推 baseHsl → setBaseHsl（MCSDA：base 静态 + 残差被平流）
//      - 区域边界 → 障碍物纹理（限制流体在区域内）
//   2. fluidConfig 参数变化时调用 updateConfig（廉价，保留模拟状态；仅分辨率变化才重建网格）
//   3. 卸载/重绑定/重新导入时 dispose 旧解算器
//
// 解算器实例通过返回的 ref 暴露给 MainCanvas 的 animate 循环：
//   const solverRef = useFluidSolver(rendererRef, activeLayerId, frameData, regionEntities);
//   → solverRef.current.step(dt) / composite() / getCompositeTexture()
//
// 注意：本 hook 只管生命周期，不驱动每帧 step（由 MainCanvas animate 循环负责，
//       因为它持有 colorMeshUniformsRef 用于交换 uColorTex）。

export function useFluidSolver(
  rendererRef: MutableRefObject<THREE.WebGLRenderer | null>,
  activeLayerId: string | null,
  frameData: FrameData | undefined,
  regionEntities: RegionEntity[],
): MutableRefObject<FluidSolver | null> {
  const solverRef = useRef<FluidSolver | null>(null);

  const fluidConfig = frameData?.fluidConfig;
  const hasFluid = !!fluidConfig;
  const boundRegionId = frameData?.boundRegionId ?? null;
  const residualTex = frameData?.boundResidualTexture ?? null;
  const baseTex = frameData?.boundBaseTexture ?? null;
  // 区域实体列表 identity 变化时重建障碍物
  const entitiesKey = regionEntities.map(e => `${e.id}:${e.boundary.length}`).join('|');
  // ★ 墙掩码引用跟踪：热更新 effect 据此判断是否需重建障碍物纹理
  const lastObstacleRef = useRef<FluidSolverConfig['obstacle'] | undefined>(undefined);
  // ★ 墙掩码使用开关跟踪：切换时热更新重建障碍物纹理
  const lastWallMaskToggleRef = useRef<boolean | undefined>(undefined);

  // ---- 创建 / 销毁 ----
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !hasFluid || !fluidConfig) {
      // 无流体配置：释放旧解算器
      if (solverRef.current) {
        solverRef.current.dispose();
        solverRef.current = null;
      }
      return;
    }
    // 必须有可平流的目标纹理（残差优先，否则回退到 base 全帧 direct 模式）
    const targetTex = residualTex || baseTex;
    if (!targetTex) {
      console.warn('[useFluidSolver] 流体已启用但未绑定帧纹理，跳过解算器创建');
      if (solverRef.current) {
        solverRef.current.dispose();
        solverRef.current = null;
      }
      return;
    }

    const resolution = resolveFluidResolution(frameData!);
    // 合并默认值，确保字段完整（旧配置可能缺项）
    const cfg: FluidSolverConfig = {
      ...defaultFluidConfig,
      ...fluidConfig,
      scalarConfig: { ...defaultFluidConfig.scalarConfig, ...(fluidConfig.scalarConfig ?? {}) },
      // ★ Level Set 配置合并（轻量化默认关闭）
      levelSetConfig: { ...defaultFluidConfig.levelSetConfig, ...(fluidConfig.levelSetConfig ?? {}) },
      resolution: { ...resolution },
    };

    // 若已存在解算器且分辨率相同，复用（避免重建丢失状态）；否则新建
    let solver: FluidSolver | null = solverRef.current;
    const needRebuild = !solver
      || solver.config.resolution.w !== resolution.w
      || solver.config.resolution.h !== resolution.h;
    if (needRebuild) {
      if (solver) solver.dispose();
      solver = new FluidSolver(renderer, cfg, resolution);
      solverRef.current = solver;
    } else if (solver) {
      // ★ 复用现有 solver 时，同步更新配置（包括 levelSetConfig 启用状态切换）
      solver.updateConfig(cfg);
    }
    // needRebuild=false 时 solver 必非空；needRebuild=true 时已赋值。TS 无法推断，显式断言：
    if (!solver) return;

    // ★ 流体直接作用在「残差」上：colorGrid = 残差（被平流），base 静态
    //   当没有残差纹理时，创建中性残差（全 128，即 delta=0），避免将帧纹理当作残差导致帧变亮
    if (residualTex) {
      solver.loadResidual(residualTex);
    } else {
      // 创建中性残差（R=G=B=A=128），确保所有 delta≈0
      const w = resolution.w;
      const h = resolution.h;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const neutralImageData = ctx.createImageData(w, h);
      const data = neutralImageData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 128;     // R → dH = (128/255*2 - 1)*0.5 ≈ 0
        data[i + 1] = 128; // G → dS ≈ 0
        data[i + 2] = 128; // B → dL ≈ 0
        data[i + 3] = 128; // A → dA ≈ 0（之前是255，会导致dA=0.5！）
      }
      solver.loadResidual(neutralImageData);
    }

    // MCSDA：反推 baseHsl，使 composite = base + 平流(残差)
    //   有 boundBaseTexture 时，始终用 MCSDA 模式（即使没有 residual，不减 delta）
    //   只有完全没有纹理时才退化为 Direct 模式
    let isMCSDA = false;
    if (baseTex) {
      const baseHsl = buildBaseHslFromFrame(frameData!);
      if (baseHsl) {
        solver.setBaseHsl(baseHsl.data, baseHsl.width, baseHsl.height);
        isMCSDA = true;
      }
    }
    if (!isMCSDA) {
      solver.clearBaseHsl();
    }

    // 障碍物：优先使用导入的墙掩码（多帧物理配置），否则用当前绑定区域的边界
    const obstacleMask = fluidConfig.obstacle;
    const useWallMask = frameData?.fluidRuntime?.useWallMask ?? true;
    let obstacle: THREE.DataTexture | null = null;
    if (useWallMask && obstacleMask && obstacleMask.data) {
      obstacle = buildObstacleTextureFromBitmask(
        obstacleMask.width,
        obstacleMask.height,
        obstacleMask.data,
        resolution.w,
        resolution.h,
      );
    }
    if (!obstacle) {
      const boundEntity = regionEntities.find(e => e.id === boundRegionId);
      if (boundEntity && boundEntity.boundary.length > 0) {
        obstacle = rasterizeBoundaryToObstacle(boundEntity.boundary, resolution.w, resolution.h);
      }
    }
    solver.setObstacleTexture(obstacle);

    // ★ Level Set：若已启用，基于实际 density/colorGrid 数据重新初始化 φ 场
    //   构造函数中 enableLevelSet 在 density 注入前调用，phi 会是空的，
    //   这里在数据就绪后重置一次，确保 φ 场反映真实浓度分布
    if (cfg.levelSetConfig?.enabled) {
      solver.resetLevelSet();
    }

    // 首帧合成，立即产出可显示的 compositeTarget
    solver.composite();

    console.log(
      `[useFluidSolver] layer="${activeLayerId}" region=#${boundRegionId} ` +
      `mode=${isMCSDA ? 'MCSDA' : 'direct'} res=${resolution.w}x${resolution.h} ` +
      `levelSet=${cfg.levelSetConfig?.enabled ? 'ON' : 'off'}`,
    );

    // 清理函数：仅在组件卸载或下一次 effect 重跑前调用
    return () => {
      // 注意：不在这里 dispose，因为 StrictMode 双调用会误删；
      //       真正的 dispose 由下一次 needRebuild 或无配置分支处理。
      //       组件卸载时由最终清理分支处理（hasFluid=false）。
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFluid, boundRegionId, residualTex, baseTex, entitiesKey, activeLayerId]);

  // ---- 配置参数热更新（不重建网格，保留模拟状态）----
  useEffect(() => {
    const solver = solverRef.current;
    if (!solver || !fluidConfig) return;
    console.log(`[useFluidSolver] 配置热更新，continuousSources=${(fluidConfig.continuousSources ?? []).length}`, 
      fluidConfig.continuousSources?.map((s: any) => `(${(s.position?.x ?? 0).toFixed(2)},${(s.position?.y ?? 0).toFixed(2)})r=${s.radius}`).join(' '));
    // updateConfig 内部仅在 resolution 变化时 rebuild，其余字段直接合并
    solver.updateConfig({
      ...fluidConfig,
      // 分辨率交由上面的创建 effect 控制（避免此处触发 rebuild 与之冲突）
      resolution: solver.config.resolution,
    });
    // ★ 墙掩码引用或使用开关变化时重建障碍物纹理（创建 effect 之外，避免整库重建）
    const useWallMask = frameData?.fluidRuntime?.useWallMask ?? true;
    if (lastObstacleRef.current !== fluidConfig.obstacle || lastWallMaskToggleRef.current !== useWallMask) {
      lastObstacleRef.current = fluidConfig.obstacle;
      lastWallMaskToggleRef.current = useWallMask;
      const obstacleMask = fluidConfig.obstacle;
      let obstacle: THREE.DataTexture | null = null;
      if (useWallMask && obstacleMask && obstacleMask.data) {
        obstacle = buildObstacleTextureFromBitmask(
          obstacleMask.width,
          obstacleMask.height,
          obstacleMask.data,
          solver.config.resolution.w,
          solver.config.resolution.h,
        );
      }
      if (!obstacle) {
        const boundEntity = regionEntities.find(e => e.id === boundRegionId);
        if (boundEntity && boundEntity.boundary.length > 0) {
          obstacle = rasterizeBoundaryToObstacle(boundEntity.boundary, solver.config.resolution.w, solver.config.resolution.h);
        }
      }
    solver.setObstacleTexture(obstacle);
    lastObstacleRef.current = fluidConfig.obstacle;
    }
  }, [fluidConfig, frameData?.fluidRuntime?.useWallMask]);

  // ---- 组件卸载时释放 ----
  useEffect(() => {
    return () => {
      if (solverRef.current) {
        solverRef.current.dispose();
        solverRef.current = null;
      }
    };
  }, []);

  return solverRef;
}