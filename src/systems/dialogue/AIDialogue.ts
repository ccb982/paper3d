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
        resolve(randomResponse ? randomResponse : '');

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
    const reply = data.reply;
    return (reply && typeof reply === 'string' && reply !== 'undefined') ? reply : '';
  } catch (error) {
    console.error('AI 请求错误:', error);
    return '（AI 暂时无法回应）';
  }
};
