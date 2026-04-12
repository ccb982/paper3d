import { useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { fetchAIResponse } from './AIDialogue';

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

      gameStore.setDialogText(reply);
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
