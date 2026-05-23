import { useAppStore } from './stores/useAppStore';
import { ImageImport } from './components/ImageImport';
import { LayerControl } from './components/LayerControl';
import { MainCanvas } from './components/MainCanvas';

function App() {
  const { layerVisibility } = useAppStore();

  return (
    <div className="app-container">
      <aside className="sidebar">
        <ImageImport />
        <LayerControl />
      </aside>
      <div className="canvas-container">
        <MainCanvas />
      </div>
    </div>
  );
}

export default App;
