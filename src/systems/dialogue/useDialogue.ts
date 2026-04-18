import { useRef, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';
import { fetchAIResponse } from './AIDialogue';

export const useDialogue = () => {
  const abortControllerRef = useRef<AbortController | null>(null);
  const dialogueTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gameStore = useGameStore();

  const triggerDialogue = async (characterId: string = 'player') => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      gameStore.setIsLoading(true);
      gameStore.setDialogVisible(true);

      const prompt = `你是一个纸片人角色，和用户进行对话。你需要友好地回应，内容要有趣且符合游戏场景。`;

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

  // 随机触发对话的函数
  const startRandomDialogue = () => {
    // 清除之前的定时器
    if (dialogueTimerRef.current) {
      clearTimeout(dialogueTimerRef.current);
    }

    // 随机生成下一次对话的时间间隔（10秒到60秒之间）
    const randomInterval = Math.floor(Math.random() * 50000) + 10000; // 10000ms 到 60000ms

    // 设置定时器
    dialogueTimerRef.current = setTimeout(() => {
      // 触发对话
      triggerDialogue();
      // 递归调用，继续设置下一次对话
      startRandomDialogue();
    }, randomInterval);
  };

  // 组件挂载时启动随机对话
  useEffect(() => {
    startRandomDialogue();

    // 组件卸载时清除定时器
    return () => {
      if (dialogueTimerRef.current) {
        clearTimeout(dialogueTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return { triggerDialogue, startRandomDialogue };
};
