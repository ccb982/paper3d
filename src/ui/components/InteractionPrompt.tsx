import React from 'react';
import type { InteractiveObject } from '../../utils/interactionDetector';

interface InteractionPromptProps {
  interactiveObjects: InteractiveObject[];
  onInteract: (object: InteractiveObject) => void;
}

export const InteractionPrompt: React.FC<InteractionPromptProps> = ({
  interactiveObjects,
  onInteract
}) => {
  if (interactiveObjects.length === 0) {
    return null;
  }

  const getPromptText = (type: InteractiveObject['type']) => {
    switch (type) {
      case 'box':
        return '打开箱子';
      case 'npc':
        return '与NPC对话';
      case 'door':
        return '开门';
      case 'chest':
        return '打开宝箱';
      default:
        return '交互';
    }
  };

  return (
    <div style={{
      position: 'absolute',
      bottom: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      zIndex: 1000,
      pointerEvents: 'none'
    }}>
      {interactiveObjects.map((obj, index) => (
        <div
          key={obj.id}
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '6px',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            pointerEvents: 'auto',
            cursor: 'pointer',
            border: '2px solid #4CAF50',
            boxShadow: '0 0 10px rgba(76, 175, 80, 0.3)'
          }}
          onClick={() => onInteract(obj)}
        >
          <span style={{ fontSize: '18px' }}>
            {obj.type === 'box' && '📦'}
            {obj.type === 'npc' && '👤'}
            {obj.type === 'door' && '🚪'}
            {obj.type === 'chest' && '🎁'}
            {obj.type === 'other' && '❓'}
          </span>
          <span style={{ fontWeight: 'bold' }}>{obj.name}</span>
          <span style={{ color: '#aaa', fontSize: '12px' }}>
            {obj.distance.toFixed(1)}米
          </span>
          <span style={{
            backgroundColor: '#4CAF50',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 'bold'
          }}>
            {getPromptText(obj.type)} [E]
          </span>
        </div>
      ))}
    </div>
  );
};