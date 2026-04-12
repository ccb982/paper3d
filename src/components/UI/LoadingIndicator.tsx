import React from 'react';
import { useGameStore } from '../../systems/state/gameStore';

const LoadingIndicator: React.FC = () => {
  const { isLoading } = useGameStore();

  if (!isLoading) {
    return null;
  }

  return (
    <div className="loading-indicator">
      <div className="loading-spinner"></div>
    </div>
  );
};

export default LoadingIndicator;