import { create } from 'zustand';

// 页面模式枚举
export enum GameMode {
  MENU = 'menu',
  DAILY = 'daily',
  BATTLE = 'battle',
  SHOP = 'shop',
  GACHA = 'gacha',
  SETTING = 'setting',
}

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

export interface GameState {
  mode: GameMode;
  previousMode: GameMode;
  character: CharacterState;
  dialog: DialogState;
  isLoading: boolean;
  isMuted: boolean;
  volume: number;
  isDebug: boolean;
  playSoundCallback: (() => void) | null;

  // Actions
  setMode: (mode: GameMode) => void;
  startBattle: () => void;
  exitBattle: () => void;
  openDaily: () => void;
  exitDaily: () => void;
  openShop: () => void;
  exitShop: () => void;
  openGacha: () => void;
  exitGacha: () => void;
  openSettings: () => void;
  exitSettings: () => void;
  setCharacterPosition: (pos: { x: number; z: number; y?: number }) => void;
  setCharacterVelocity: (vel: { x: number; y: number; z: number }) => void;
  setCharacterMoving: (moving: boolean) => void;
  setDialogText: (text: string) => void;
  setDialogVisible: (visible: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  toggleMute: () => void;
  registerSoundCallback: (cb: () => void) => void;
  playSound: () => void;
  toggleDebug: () => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  // 页面模式
  mode: GameMode.MENU,
  previousMode: GameMode.MENU,

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
  isDebug: true,
  playSoundCallback: null,

  // 页面切换方法
  setMode: (mode) => set({ previousMode: get().mode, mode }),
  startBattle: () => set({ mode: GameMode.BATTLE }),
  exitBattle: () => set({ mode: get().previousMode }),
  openDaily: () => set({ mode: GameMode.DAILY }),
  exitDaily: () => set({ mode: GameMode.MENU }),
  openShop: () => set({ mode: GameMode.SHOP }),
  exitShop: () => set({ mode: get().previousMode }),
  openGacha: () => set({ mode: GameMode.GACHA }),
  exitGacha: () => set({ mode: get().previousMode }),
  openSettings: () => set({ mode: GameMode.SETTING }),
  exitSettings: () => set({ mode: get().previousMode }),

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
  toggleDebug: () => set((state) => ({ isDebug: !state.isDebug }))
}));