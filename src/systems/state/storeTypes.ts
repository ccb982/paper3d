export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface CharacterState {
  position: Position;
  isMoving: boolean;
}

export interface DialogState {
  text: string;
  visible: boolean;
}

export interface GameState {
  character: CharacterState;
  dialog: DialogState;
  isLoading: boolean;
  isMuted: boolean;
  volume: number;
  playSoundCallback: (() => void) | null;

  // Actions
  setCharacterPosition: (pos: { x: number; z: number }) => void;
  setCharacterMoving: (moving: boolean) => void;
  setDialogText: (text: string) => void;
  setDialogVisible: (visible: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  toggleMute: () => void;
  registerSoundCallback: (cb: () => void) => void;
  playSound: () => void;
}