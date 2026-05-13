import { Explosion1DSolver } from '../Explosion1DSolver';
import { ExplosionParams } from '../types';

export class ExplosionManager {
  private explosions: Map<string, Explosion1DSolver> = new Map();
  private graphicsTime: number = 0;

  public create(id: string, params: ExplosionParams): Explosion1DSolver {
    if (this.explosions.has(id)) {
      console.warn(`Explosion with id "${id}" already exists, removing old one`);
      this.remove(id);
    }
    const explosion = new Explosion1DSolver(params);
    this.explosions.set(id, explosion);
    return explosion;
  }

  public get(id: string): Explosion1DSolver | undefined {
    return this.explosions.get(id);
  }

  public remove(id: string): void {
    const explosion = this.explosions.get(id);
    if (explosion) {
      explosion.destroy();
      this.explosions.delete(id);
    }
  }

  public has(id: string): boolean {
    return this.explosions.has(id);
  }

  public updateAll(graphicsDelta: number): void {
    this.graphicsTime += graphicsDelta;
    this.explosions.forEach((explosion) => {
      if (explosion.isActive()) {
        explosion.advanceTo(this.graphicsTime);
      }
    });
  }

  public advanceTo(targetTime: number): void {
    this.graphicsTime = targetTime;
    this.explosions.forEach((explosion) => {
      if (explosion.isActive()) {
        explosion.advanceTo(targetTime);
      }
    });
  }

  public getActiveExplosions(): Explosion1DSolver[] {
    return Array.from(this.explosions.values()).filter((exp) => exp.isActive());
  }

  public getAllExplosions(): Explosion1DSolver[] {
    return Array.from(this.explosions.values());
  }

  public getCount(): number {
    return this.explosions.size;
  }

  public getActiveCount(): number {
    return this.getActiveExplosions().length;
  }

  public clear(): void {
    this.explosions.forEach((explosion) => {
      explosion.destroy();
    });
    this.explosions.clear();
    this.graphicsTime = 0;
  }

  public getGraphicsTime(): number {
    return this.graphicsTime;
  }

  public forEach(callback: (explosion: Explosion1DSolver, id: string) => void): void {
    this.explosions.forEach((explosion, id) => {
      callback(explosion, id);
    });
  }

  public cleanupInactive(): void {
    const toRemove: string[] = [];
    this.explosions.forEach((explosion, id) => {
      if (!explosion.isActive()) {
        toRemove.push(id);
      }
    });
    toRemove.forEach((id) => this.remove(id));
  }
}