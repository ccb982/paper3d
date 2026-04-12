import { create } from 'zustand';
import { GameState } from './storeTypes';

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
  setDialogText: (text) => set((state) => ({
    dialog: {
      ...state.dialog,
      text
    }
  })),
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