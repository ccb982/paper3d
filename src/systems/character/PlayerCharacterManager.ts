import { CharacterEntity } from '../../entities/characters/CharacterEntity';
import { characterPositionStore } from './CharacterPositionStore';

export class PlayerCharacterManager {
  private static instance: PlayerCharacterManager;
  private _currentCharacter: CharacterEntity | null = null;

  private constructor() {}

  public static getInstance(): PlayerCharacterManager {
    if (!PlayerCharacterManager.instance) {
      PlayerCharacterManager.instance = new PlayerCharacterManager();
    }
    return PlayerCharacterManager.instance;
  }

  public setCurrentCharacter(character: CharacterEntity | null): void {
    if (this._currentCharacter === character) return;
    this._currentCharacter = character;
    if (character) {
      const pos = character.position.clone();
      characterPositionStore.setPosition(pos.x, pos.y, pos.z);
    }
  }

  public getCurrentCharacter(): CharacterEntity | null {
    return this._currentCharacter;
  }

  public updateCurrentCharacterPosition(x: number, y: number, z: number): void {
    if (this._currentCharacter) {
      this._currentCharacter.position.set(x, y, z);
      this._currentCharacter.mesh.position.set(x, y, z);
      characterPositionStore.setPosition(x, y, z);
    }
  }

  public getCurrentCharacterId(): string | null {
    return this._currentCharacter?.id || null;
  }

  public isCurrentCharacter(characterId: string): boolean {
    return this._currentCharacter?.id === characterId;
  }
}

export const playerCharacterManager = PlayerCharacterManager.getInstance();