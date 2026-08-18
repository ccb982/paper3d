// ============================================================
// IGameMode.ts —— 统一模式接口
// 所有模式（ShipMode / WorldMode / BossMode）实现此接口，
// main.ts 只依赖此接口，不做"管家"。
// ============================================================
// 核心原则："谁创建，谁销毁；谁拥有，谁负责"
// - 每个 Mode 拥有自己的"私有领地"（场景子元素、物理世界、输入绑定、实体）
// - enter() 接收共享资源 + 生命周期回调
// - exit() 必须完整清理所有私有资源，不留痕迹
// - main.ts 只做"路由器"：初始化共享资源 + 响应切换事件
// ============================================================

import * as THREE from 'three';
import type { GameSession } from './Session';

export interface IGameModeContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  session: GameSession;
  /** 返回回调：WorldMode 按 E 键时触发 → main 进入 ShipMode */
  onReturn?: () => void;
  /** 出击回调：ShipMode 点击"出击"时触发 → main 进入 WorldMode */
  onDepart?: (day: number, stats: import('./Session').PlayerCombatStats) => void;
}

export interface IGameMode {
  /** 进入模式（接收共享资源，创建私有资源） */
  enter(context: IGameModeContext): void;

  /** 退出模式（完整清理所有私有资源） */
  exit(): void;

  /** 每帧更新 */
  update(dt: number): void;

  /** 每帧渲染 */
  render(): void;
}