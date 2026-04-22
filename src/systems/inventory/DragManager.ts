import { Item } from '../../entities/items/ItemData';
import { InventorySystem } from './InventorySystem';
import { backpackManager } from './BackpackManager';

interface DraggedItem {
  item: Item;
  sourceInventory: InventorySystem;
  sourcePosition: { x: number; y: number };
  currentPosition: { x: number; y: number };
  currentInventory: 'backpack' | 'box' | null;
}

export class DragManager {
  private static instance: DragManager;
  private draggedItem: DraggedItem | null = null;
  private listeners: Map<string, Array<() => void>> = new Map();
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;
  private boxInventory: InventorySystem | null = null;

  private constructor() {}

  public static getInstance(): DragManager {
    if (!DragManager.instance) {
      DragManager.instance = new DragManager();
    }
    return DragManager.instance;
  }

  public setBoxInventory(inv: InventorySystem | null) {
    this.boxInventory = inv;
  }

  public addListener(containerType: string, listener: () => void): void {
    if (!this.listeners.has(containerType)) {
      this.listeners.set(containerType, []);
    }
    this.listeners.get(containerType)?.push(listener);
  }

  public removeListener(containerType: string, listener: () => void): void {
    const containerListeners = this.listeners.get(containerType);
    if (containerListeners) {
      this.listeners.set(containerType, containerListeners.filter(l => l !== listener));
    }
  }

  public startDrag(item: Item, inventory: InventorySystem, position: { x: number; y: number }): void {
    // 确定物品来源
    const isBackpack = inventory === backpackManager.getInventory();
    
    this.draggedItem = {
      item,
      sourceInventory: inventory,
      sourcePosition: position,
      currentPosition: position,
      currentInventory: isBackpack ? 'backpack' : 'box'
    };
    // 从源背包移除物品
    inventory.removeItemAt(position.x, position.y);
    this.notifyListeners();

    // 添加全局鼠标事件监听
    this.addGlobalListeners();
  }

  private addGlobalListeners(): void {
    this.mouseMoveHandler = (e: MouseEvent) => {
      this.handleGlobalMouseMove(e);
    };
    this.mouseUpHandler = (e: MouseEvent) => {
      this.handleGlobalMouseUp(e);
    };

    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('mouseup', this.mouseUpHandler);
  }

  private removeGlobalListeners(): void {
    if (this.mouseMoveHandler) {
      document.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
    if (this.mouseUpHandler) {
      document.removeEventListener('mouseup', this.mouseUpHandler);
      this.mouseUpHandler = null;
    }
  }

  private handleGlobalMouseMove(e: MouseEvent): void {
    if (!this.draggedItem) return;

    // 检测所有带有data-container属性的网格
    const gridElements = document.querySelectorAll('[data-container]');
    
    for (const gridElement of gridElements) {
      const containerType = gridElement.getAttribute('data-container');
      if (!containerType) continue;
      
      const rect = gridElement.getBoundingClientRect();
      if (this.isPointInRect(e, rect)) {
        let cols = 0;
        let rows = 0;
        
        if (containerType === 'backpack') {
          cols = 5;
          rows = 8;
        } else if (containerType === 'box') {
          cols = 4;
          rows = 3;
        }
        
        const pos = this.calculateGridPosition(e, rect, cols, rows);
        if (pos) {
          this.draggedItem.currentPosition = pos;
          this.draggedItem.currentInventory = containerType as 'backpack' | 'box';
          this.notifyListeners();
          return;
        }
      }
    }

    // 不在任何网格内
    this.draggedItem.currentInventory = null;
    this.notifyListeners();
  }

  private handleGlobalMouseUp(e: MouseEvent): void {
    if (!this.draggedItem) {
      this.removeGlobalListeners();
      return;
    }

    let targetInventory: InventorySystem | null = null;
    let targetPos: { x: number; y: number } | null = null;

    // 检测所有带有data-container属性的网格
    const gridElements = document.querySelectorAll('[data-container]');
    
    for (const gridElement of gridElements) {
      const containerType = gridElement.getAttribute('data-container');
      if (!containerType) continue;
      
      const rect = gridElement.getBoundingClientRect();
      if (this.isPointInRect(e, rect)) {
        let cols = 0;
        let rows = 0;
        
        if (containerType === 'backpack') {
          targetInventory = backpackManager.getInventory();
          cols = 5;
          rows = 8;
        } else if (containerType === 'box') {
          targetInventory = this.boxInventory;
          cols = 4;
          rows = 3;
        }
        
        targetPos = this.calculateGridPosition(e, rect, cols, rows);
        break;
      }
    }

    // 鼠标不在任何网格内，放回原位置
    this.endDrag(targetInventory, targetPos);
    this.removeGlobalListeners();
  }

  private isPointInRect(e: MouseEvent, rect: DOMRect): boolean {
    return e.clientX >= rect.left && e.clientX <= rect.right &&
           e.clientY >= rect.top && e.clientY <= rect.bottom;
  }

  private calculateGridPosition(e: MouseEvent, rect: DOMRect, cols: number, rows: number): { x: number; y: number } | null {
    const cellWidth = rect.width / cols;
    const cellHeight = rect.height / rows;
    const x = Math.floor((e.clientX - rect.left) / cellWidth);
    const y = Math.floor((e.clientY - rect.top) / cellHeight);
    if (x >= 0 && x < cols && y >= 0 && y < rows) {
      return { x, y };
    }
    return null;
  }

  private getGridSize(element: Element): { cols: number; rows: number } {
    // 根据 ID 返回不同尺寸
    if (element.closest('#backpack-ui')) return { cols: 5, rows: 8 };
    if (element.closest('#box-ui')) return { cols: 4, rows: 3 };
    return { cols: 0, rows: 0 };
  }

  public endDrag(targetInventory: InventorySystem | null, targetPosition: { x: number; y: number } | null): boolean {
    if (!this.draggedItem) {
      return false;
    }

    let success = false;

    if (targetInventory && targetPosition) {
      // 尝试放置到目标背包
      success = targetInventory.addItem(this.draggedItem.item, targetPosition.x, targetPosition.y);
    }

    if (!success) {
      // 放置失败，放回源背包
      this.draggedItem.sourceInventory.addItem(
        this.draggedItem.item,
        this.draggedItem.sourcePosition.x,
        this.draggedItem.sourcePosition.y
      );
    }

    this.draggedItem = null;
    this.notifyListeners();
    return success;
  }

  public getDraggedItem(): DraggedItem | null {
    return this.draggedItem;
  }

  public isDragging(): boolean {
    return this.draggedItem !== null;
  }

  private notifyListeners(): void {
    if (!this.draggedItem) return;
    
    // 只通知当前拖拽目标容器的监听器
    const targetContainer = this.draggedItem.currentInventory;
    if (targetContainer) {
      const containerListeners = this.listeners.get(targetContainer);
      if (containerListeners) {
        for (const listener of containerListeners) {
          listener();
        }
      }
    }
    
    // 同时通知源容器的监听器，以便更新源容器的状态
    const sourceContainer = this.draggedItem.sourceInventory === backpackManager.getInventory() ? 'backpack' : 'box';
    const sourceListeners = this.listeners.get(sourceContainer);
    if (sourceListeners) {
      for (const listener of sourceListeners) {
        listener();
      }
    }
  }
}