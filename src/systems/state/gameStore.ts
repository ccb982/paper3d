import { create } from 'zustand';

// 直接在文件内部定义类型
export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface CharacterState {
  position: Position;
  isMoving: boolean;
  velocity: { x: number; y: number; z: number };
}

export interface DialogState {
  text: string;
  visible: boolean;
}

export interface MousePosition {
  x: number;
  y: number;
  gameX?: number;
  gameY?: number;
  gameZ?: number;
}

export interface GameState {
  character: CharacterState;
  dialog: DialogState;
  isLoading: boolean;
  isMuted: boolean;
  volume: number;
  playSoundCallback: (() => void) | null;
  cameraPosition: Position;
  mousePosition: MousePosition;
  raycastInfo: {
    active: boolean;
    shootableObjects: number;
    intersects: number;
    locked: boolean;
  };
  shootInfo: {
    isFiring: boolean;
    fireCount: number;
  };

  // Actions
  setCharacterPosition: (pos: { x: number; z: number; y?: number }) => void;
  setCharacterVelocity: (vel: { x: number; y: number; z: number }) => void;
  setCharacterMoving: (moving: boolean) => void;
  setDialogText: (text: string) => void;
  setDialogVisible: (visible: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  toggleMute: () => void;
  registerSoundCallback: (cb: () => void) => void;
  playSound: () => void;
  setCameraPosition: (pos: { x: number; y: number; z: number }) => void;
  setMousePosition: (pos: MousePosition) => void;
  setRaycastInfo: (info: Partial<GameState['raycastInfo']>) => void;
  setShootInfo: (info: Partial<GameState['shootInfo']>) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  // 初始状态
  character: {
    position: { x: 0, y: 1.5, z: 0 },
    isMoving: false,
    velocity: { x: 0, y: 0, z: 0 }
  },
  dialog: {
    text: '',
    visible: false
  },
  isLoading: false,
  isMuted: false,
  volume: 1,
  playSoundCallback: null,
  cameraPosition: { x: 0, y: 2, z: 10 },
  mousePosition: { x: 0, y: 0 },
  raycastInfo: {
    active: false,
    shootableObjects: 0,
    intersects: 0,
    locked: false
  },
  shootInfo: {
    isFiring: false,
    fireCount: 0
  },


  // Actions
  setCharacterPosition: (pos) => set((state) => ({
    character: {
      ...state.character,
      position: {
        ...state.character.position,
        x: pos.x,
        z: pos.z,
        ...(pos.y !== undefined && { y: pos.y })
      }
    }
  })),
  setCharacterVelocity: (vel) => set((state) => ({
    character: {
      ...state.character,
      velocity: vel
    }
  })),
  setCharacterMoving: (moving) => set((state) => ({
    character: {
      ...state.character,
      isMoving: moving
    }
  })),
  setDialogText: (text) => set((state) => {
    // 确保 text 是有效的字符串，且不是 "undefined"
    let safeText = (text == null || text === 'undefined') ? '' : String(text);
    return {
      dialog: {
        ...state.dialog,
        text: safeText
      }
    };
  }),
  setDialogVisible: (visible) => set((state) => ({
    dialog: {
      ...state.dialog,
      visible
    }
  })),
  setIsLoading: (loading) => set({ isLoading: loading }),
  toggleMute: () => set((state) => ({
    isMuted: !state.isMuted
  })),
  registerSoundCallback: (cb) => set({ playSoundCallback: cb }),
  playSound: () => {
    const callback = get().playSoundCallback;
    if (callback) {
      callback();
    }
  },
  setCameraPosition: (pos) => set({ cameraPosition: pos }),
  setMousePosition: (pos) => set({ mousePosition: pos }),
  setRaycastInfo: (info) => set((state) => ({
    raycastInfo: {
      ...state.raycastInfo,
      ...info
    }
  })),
  setShootInfo: (info) => set((state) => ({
    shootInfo: {
      ...state.shootInfo,
      ...info
    }
  }))
}));