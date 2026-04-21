import { Item } from '../../entities/items/ItemData';
import { InventorySystem } from './InventorySystem';

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