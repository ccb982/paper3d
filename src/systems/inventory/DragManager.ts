import { Item } from '../../entities/items/ItemData';
import { InventorySystem } from './InventorySystem';
import { backpackManager } from './BackpackManager';

interface DraggedItem {
  item: Item;
  sourceInventory: InventorySystem;
  sourcePosition: { x: number; y: number };
  currentPosition: { x: number; y: number };
}

export class DragManager {
  private static instance: DragManager;
  private draggedItem: DraggedItem | null = null;
  private listeners: Array<() => void> = [];
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;

  private constructor() {}

  public static getInstance(): DragManager {
    if (!DragManager.instance) {
      DragManager.instance = new DragManager();
    }
    return DragManager.instance;
  }

  public startDrag(item: Item, inventory: InventorySystem, position: { x: number; y: number }): void {
    this.draggedItem = {
      item,
      sourceInventory: inventory,
      sourcePosition: position,
      currentPosition: position
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

    // 检查鼠标是否在背包网格内
    const backpackElement = document.querySelector('.backpack-ui .backpack-grid');
    if (backpackElement) {
      const rect = backpackElement.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const x = Math.floor((e.clientX - rect.left - 10) / 62);
        const y = Math.floor((e.clientY - rect.top - 10) / 62);
        if (x >= 0 && x < 5 && y >= 0 && y < 8) {
          this.updatePosition({ x, y });
          return;
        }
      }
    }

    // 检查鼠标是否在箱子网格内
    const boxElement = document.querySelector('.backpack-ui[style*="right: 20px"] .backpack-grid');
    if (boxElement) {
      const rect = boxElement.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const x = Math.floor((e.clientX - rect.left - 10) / 62);
        const y = Math.floor((e.clientY - rect.top - 10) / 62);
        if (x >= 0 && x < 4 && y >= 0 && y < 3) {
          this.updatePosition({ x, y });
          return;
        }
      }
    }
  }

  private handleGlobalMouseUp(e: MouseEvent): void {
    if (!this.draggedItem) {
      this.removeGlobalListeners();
      return;
    }

    // 检查鼠标是否在背包网格内
    const backpackElement = document.querySelector('.backpack-ui .backpack-grid');
    if (backpackElement) {
      const rect = backpackElement.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const x = Math.floor((e.clientX - rect.left - 10) / 62);
        const y = Math.floor((e.clientY - rect.top - 10) / 62);
        if (x >= 0 && x < 5 && y >= 0 && y < 8) {
          // 从背包管理器获取背包库存
          this.endDrag(backpackManager.getInventory(), { x, y });
          this.removeGlobalListeners();
          return;
        }
      }
    }

    // 检查鼠标是否在箱子网格内
    const boxElement = document.querySelector('.backpack-ui[style*="right: 20px"] .backpack-grid');
    if (boxElement) {
      const rect = boxElement.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const x = Math.floor((e.clientX - rect.left - 10) / 62);
        const y = Math.floor((e.clientY - rect.top - 10) / 62);
        if (x >= 0 && x < 4 && y >= 0 && y < 3) {
          // 从App组件获取当前箱子的库存
          const currentBox = (window as any).currentBox;
          if (currentBox && currentBox.getInventory) {
            this.endDrag(currentBox.getInventory(), { x, y });
            this.removeGlobalListeners();
            return;
          }
        }
      }
    }

    // 鼠标不在任何网格内，放回原位置
    this.endDrag(null, null);
    this.removeGlobalListeners();
  }

  public updatePosition(position: { x: number; y: number }): void {
    if (this.draggedItem) {
      this.draggedItem.currentPosition = position;
      this.notifyListeners();
    }
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