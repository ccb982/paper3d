import { Entity } from './Entity';
import { EntityManager } from './EntityManager';

type CollisionCallback = (a: Entity, b: Entity) => void;

class GridSpatialPartition {
  private cellSize: number;
  private grid: Map<string, Entity[]>;

  constructor(cellSize: number = 10) {
    this.cellSize = cellSize;
    this.grid = new Map();
  }

  private getCellKey(x: number, y: number, z: number): string {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    const cellZ = Math.floor(z / this.cellSize);
    return `${cellX},${cellY},${cellZ}`;
  }

  private getNeighborKeys(cellKey: string): string[] {
    const [cx, cy, cz] = cellKey.split(',').map(Number);
    const neighbors: string[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          neighbors.push(`${cx + dx},${cy + dy},${cz + dz}`);
        }
      }
    }
    return neighbors;
  }

  public clear(): void {
    this.grid.clear();
  }

  public insert(entity: Entity): void {
    const key = this.getCellKey(entity.position.x, entity.position.y, entity.position.z);
    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    this.grid.get(key)!.push(entity);
  }

  public getPotentialCollisions(entity: Entity): Entity[] {
    const key = this.getCellKey(entity.position.x, entity.position.y, entity.position.z);
    const neighborKeys = this.getNeighborKeys(key);
    const candidates: Entity[] = [];

    for (const neighborKey of neighborKeys) {
      const cellEntities = this.grid.get(neighborKey);
      if (cellEntities) {
        candidates.push(...cellEntities);
      }
    }

    return candidates;
  }

  public rebuild(entities: Entity[]): void {
    this.clear();
    for (const entity of entities) {
      if (entity.isActive) {
        this.insert(entity);
      }
    }
  }
}

export class CollisionManager {
  private static instance: CollisionManager;
  private callbacks: Map<string, CollisionCallback> = new Map();
  private spatialPartition: GridSpatialPartition;
  private collisionCooldowns: Map<string, number>;

  private constructor() {
    this.spatialPartition = new GridSpatialPartition(10);
    this.collisionCooldowns = new Map();
  }

  public static getInstance(): CollisionManager {
    if (!CollisionManager.instance) {
      CollisionManager.instance = new CollisionManager();
    }
    return CollisionManager.instance;
  }

  public registerCollision(typeA: string, typeB: string, callback: CollisionCallback): void {
    const key = `${typeA}|${typeB}`;
    this.callbacks.set(key, callback);
  }

  private getCollisionKey(a: Entity, b: Entity): string {
    const idA = a.id < b.id ? a.id : b.id;
    const idB = a.id < b.id ? b.id : a.id;
    return `${idA}-${idB}`;
  }

  private canCollide(a: Entity, b: Entity): boolean {
    const key = this.getCollisionKey(a, b);
    const lastCollision = this.collisionCooldowns.get(key);
    const now = Date.now();

    if (lastCollision && now - lastCollision < 100) {
      return false;
    }

    this.collisionCooldowns.set(key, now);
    return true;
  }

  public update(): void {
    const entities = EntityManager.getInstance().getAllEntities();

    this.spatialPartition.rebuild(entities);

    const checkedPairs = new Set<string>();

    for (const entity of entities) {
      if (!entity.isActive) continue;

      const candidates = this.spatialPartition.getPotentialCollisions(entity);

      for (const other of candidates) {
        if (!other.isActive) continue;
        if (entity === other) continue;

        const pairKey = this.getCollisionKey(entity, other);
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);

        const dx = entity.position.x - other.position.x;
        const dy = entity.position.y - other.position.y;
        const dz = entity.position.z - other.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const minDist = entity.radius + other.radius;

        if (distSq < minDist * minDist && this.canCollide(entity, other)) {
          this.handleCollision(entity, other);
        }
      }
    }

    const now = Date.now();
    for (const [key, timestamp] of this.collisionCooldowns.entries()) {
      if (now - timestamp > 5000) {
        this.collisionCooldowns.delete(key);
      }
    }
  }

  private handleCollision(a: Entity, b: Entity): void {
    let key = `${a.type}|${b.type}`;
    let callback = this.callbacks.get(key);
    if (callback) {
      callback(a, b);
      return;
    }
    key = `${b.type}|${a.type}`;
    callback = this.callbacks.get(key);
    if (callback) {
      callback(b, a);
    }
  }
}