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

export const useGameStore = create<GameState>((set, get) => ({
  // 初始状态
  character: {
    position: { x: 0, y: 0, z: 0 },
    isMoving: false
  },
  dialog: {
    text: '',
    visible: false
  },
  isLoading: false,
  isMuted: false,
  volume: 1,
  playSoundCallback: null,

  // Actions
  setCharacterPosition: (pos) => set((state) => ({
    character: {
      ...state.character,
      position: { ...state.character.position, x: pos.x, z: pos.z }
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
  }
}));