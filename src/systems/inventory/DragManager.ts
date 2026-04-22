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
  private listeners: Array<() => void> = [];
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

    // 检测背包网格
    const backpackGrid = document.querySelector('#backpack-ui .backpack-ui .backpack-grid');
    if (backpackGrid) {
      const rect = backpackGrid.getBoundingClientRect();
      if (this.isPointInRect(e, rect)) {
        const pos = this.calculateGridPosition(e, rect, 5, 8); // 5列8行
        if (pos) {
          this.draggedItem.currentPosition = pos;
          this.draggedItem.currentInventory = 'backpack';
          this.notifyListeners();
          return;
        }
      }
    }

    // 检测箱子网格
    const boxGrid = document.querySelector('#box-ui .backpack-ui .backpack-grid');
    if (boxGrid) {
      const rect = boxGrid.getBoundingClientRect();
      if (this.isPointInRect(e, rect)) {
        const pos = this.calculateGridPosition(e, rect, 4, 3); // 4列3行
        if (pos) {
          this.draggedItem.currentPosition = pos;
          this.draggedItem.currentInventory = 'box';
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

    // 检查背包
    const backpackGrid = document.querySelector('#backpack-ui .backpack-ui .backpack-grid');
    if (backpackGrid) {
      const rect = backpackGrid.getBoundingClientRect();
      if (this.isPointInRect(e, rect)) {
        targetInventory = backpackManager.getInventory();
        targetPos = this.calculateGridPosition(e, rect, 5, 8);
      }
    }

    // 检查箱子
    if (!targetInventory) {
      const boxGrid = document.querySelector('#box-ui .backpack-ui .backpack-grid');
      if (boxGrid) {
        const rect = boxGrid.getBoundingClientRect();
        if (this.isPointInRect(e, rect)) {
          targetInventory = this.boxInventory;
          targetPos = this.calculateGridPosition(e, rect, 4, 3);
        }
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

  public addListener(listener: () => void): void {
    this.listeners.push(listener);
  }

  public removeListener(listener: () => void): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}