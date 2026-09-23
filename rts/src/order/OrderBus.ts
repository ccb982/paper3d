// 命令单源（R1 第一版）：SquadOrder{source,roe} + 台账 + 3D 令牌（红=引擎/橙=队长/蓝=玩家）
import * as THREE from 'three';

export type OrderKind = 'advance' | 'flank' | 'garrison' | 'protect' | 'build' | 'retreat' | 'regroup' | 'focus' | 'bound';
export type OrderSource = 'engine' | 'leader' | 'player';
export type Roe = 'engage' | 'hold' | 'holdFire';

export interface SquadOrder {
  kind: OrderKind;
  target: { x: number; z: number };
  mission?: string;
  anchor?: { x: number; z: number };
  seq: number;
  ttl: number;
  source: OrderSource;
  roe?: Roe;
}

const COLOR: Record<OrderSource, number> = { engine: 0xff5544, leader: 0xffa733, player: 0x3399ff };

export class OrderBus {
  readonly log: SquadOrder[] = [];
  private seq = 1;
  private readonly group = new THREE.Group();
  /** ★ 发令回调（AiTrace/UI 消费；玩家与引擎同源） */
  onIssue: ((o: SquadOrder) => void) | null = null;
  constructor(scene: THREE.Scene) { scene.add(this.group); }

  /** 发令：进台账 + 落 3D 令牌（一切令走这里——引擎/队长/玩家同源） */
  issue(o: Omit<SquadOrder, 'seq'> & { seq?: number }): SquadOrder {
    const ord: SquadOrder = { ...o, seq: o.seq ?? this.seq++ };
    this.log.push(ord);
    if (this.log.length > 200) this.log.shift();
    this.marker(ord);
    this.onIssue?.(ord);
    return ord;
  }

  private marker(o: SquadOrder): void {
    const col = COLOR[o.source];
    const g = new THREE.Group();
    const mat = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthTest: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.22, 8, 24), mat());
    ring.rotation.x = -Math.PI / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 6, 6), mat());
    pole.position.y = 3;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }));
    flag.position.y = 5.6;
    g.add(ring, pole, flag);
    g.position.set(o.target.x, 0, o.target.z);
    g.renderOrder = 999;
    this.group.add(g);
    const life = Math.min(o.ttl > 0 ? o.ttl : 6, 8) * 1000;
    setTimeout(() => {
      this.group.remove(g);
      g.traverse((m) => {
        const mm = m as THREE.Mesh;
        mm.geometry?.dispose?.();
        (mm.material as THREE.Material | undefined)?.dispose?.();
      });
    }, life);
  }
}
