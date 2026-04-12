// 对话相关代码整合文件

// 1. 状态管理相关代码
import { create } from 'zustand';

// 状态类型定义
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

// Zustand store 实现
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
      text: text || ''
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

// 2. AI 对话相关代码
const MOCK_AI_ENABLED = true;

export interface DialogueMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const fetchAIResponse = async (
  prompt: string,
  signal?: AbortSignal,
  history?: DialogueMessage[]
): Promise<string> => {
  if (MOCK_AI_ENABLED) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const mockResponses = [
          "你好！很高兴见到你！",
          "今天天气真不错，不是吗？",
          "你想聊点什么呢？",
          "我是一个纸片人，很高兴能和你交流！",
          "你觉得这个游戏好玩吗？"
        ];
        const randomResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
        resolve(randomResponse || '');

      }, 1000);
    });
  }

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, history }),
      signal,
    });

    if (!response.ok) {
      throw new Error('API 请求失败');
    }

    const data = await response.json();
    return data.reply;
  } catch (error) {
    console.error('AI 请求错误:', error);
    return '（AI 暂时无法回应）';
  }
};

// 3. 对话 Hook
import { useRef } from 'react';

export const useDialogue = () => {
  const abortControllerRef = useRef<AbortController | null>(null);
  const gameStore = useGameStore();

  const triggerDialogue = async (characterId: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      gameStore.setIsLoading(true);
      gameStore.setDialogVisible(true);

      const prompt = `你是一个纸片人角色，和用户进行对话。用户点击了你，你需要友好地回应。`;

      const reply = await fetchAIResponse(prompt, abortController.signal);

      gameStore.setDialogText(reply || '');

      gameStore.setIsLoading(false);

      gameStore.playSound();
    } catch (error) {
      console.error('对话触发错误:', error);
      gameStore.setDialogText('（AI 暂时无法回应）');
      gameStore.setIsLoading(false);
    }
  };

  return { triggerDialogue };
};

// 4. 对话气泡组件
import React, { useState, useEffect, useRef as useReactRef } from 'react';

export const DialogBubble: React.FC = () => {
  const { dialog, isLoading } = useGameStore();
  const [displayText, setDisplayText] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const intervalRef = useReactRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (dialog.visible) {
      setIsVisible(true);
      setDisplayText('');
      
      // 清理之前的定时器
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      
      // 确保dialog.text是字符串且长度大于0
      const textToDisplay = dialog.text || '';
      if (textToDisplay.length > 0) {
        let currentIndex = 0;
        
        // 创建新的定时器
        intervalRef.current = setInterval(() => {
          if (currentIndex < textToDisplay.length) {
            setDisplayText(prev => prev + textToDisplay[currentIndex]);
            currentIndex++;
          } else {
            // 打字完成，清除定时器
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
          }
        }, 50);
      }
    } else {
      // 清理定时器
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsVisible(false);
      setTimeout(() => {
        setDisplayText('');
      }, 300);
    }
    
    // 清理函数
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [dialog.visible, dialog.text]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="dialog-bubble" style={{ 
      animation: 'dialogAppear 0.3s ease-out forwards',
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? 'translateX(-50%) scale(1)' : 'translateX(-50%) scale(0.8)'
    }}>
      <div className="dialog-content">
        {isLoading ? (
          <div className="loading-text">
            <span>正在思考</span>
            <span className="ellipsis">...</span>
          </div>
        ) : (
          <p>{displayText || ''}</p>
        )}
      </div>
    </div>
  );
};
