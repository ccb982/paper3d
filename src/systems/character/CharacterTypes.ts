export interface Position {
  x: number;
  z: number;
}

export interface CharacterState {
  id: string;
  position: Position;
  velocity: Position;
  isMoving: boolean;
  scale: number;
  textureUrl: string;
}

export interface Boundary {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}