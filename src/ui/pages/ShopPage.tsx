import { useGameStore } from '../../systems/state/gameStore';

export const ShopPage = () => {
  const { gold, exitShop } = useGameStore();

  return (
    <div className="shop-overlay">
      <h1>商店</h1>
      <div className="shop-content">
        <p>当前金币: {gold}</p>
        <p>商品列表待添加...</p>
        <button onClick={exitShop}>返回</button>
      </div>
    </div>
  );
};