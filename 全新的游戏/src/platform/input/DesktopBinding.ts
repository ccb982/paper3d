// ============================================================
// DesktopBinding —— 键鼠绑定（桌面，开发默认）
// ============================================================
// 监听键盘/鼠标事件 → 填充 InputActions（抽象语义）。
// 绑定只做"设备 → 语义"翻译，不含任何游戏逻辑。

import type { InputActions } from './InputActions';
import { createInputActions } from './InputActions';

const KEY_MAP: Record<string, { x?: number; y?: number }> = {
  KeyW: { y: -1 },
  ArrowUp: { y: -1 },
  KeyS: { y: 1 },
  ArrowDown: { y: 1 },
  KeyA: { x: -1 },
  ArrowLeft: { x: -1 },
  KeyD: { x: 1 },
  ArrowRight: { x: 1 },
};

export class DesktopBinding {
  private state: InputActions;
  private keyState = new Map<string, boolean>();
  private disposers: Array<() => void> = [];
  private lastMouse = { x: 0, y: 0 };
  private hasMouse = false;

  constructor(target?: HTMLElement | Window) {
    this.state = createInputActions();
    const el = target ?? window;

    const onKeyDown = (e: KeyboardEvent) => {
      if (KEY_MAP[e.code]) {
        // 方向键/WASD 不触发页面滚动
        e.preventDefault();
      }
      if (!this.keyState.get(e.code)) {
        // 上升沿：记录按下（消费式）
        if (e.code === 'KeyJ' || e.code === 'Space') this.state.pressed.attack = true;
        if (e.code === 'KeyK') this.state.pressed.dodge = true;
        if (e.code === 'KeyL') this.state.pressed.skill = true;
        if (e.code === 'KeyE') this.state.pressed.interact = true;
      }
      this.keyState.set(e.code, true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keyState.set(e.code, false);
    };
    const onMouseMove = (e: MouseEvent) => {
      this.state.pointer = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
      // ★ lookAxis 增量（像素，消费式：update() 读取后清零）
      if (this.hasMouse) {
        this.state.lookAxis.x += e.clientX - this.lastMouse.x;
        this.state.lookAxis.y += e.clientY - this.lastMouse.y;
      }
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.hasMouse = true;
    };
    // ★ 交互事件：鼠标 → 抽象语义（tap/hold/drag），触屏 Binding 填同样的语义
    let pointerDown = false;
    let lastPointer = { x: 0, y: 0 };
    const normPos = (e: MouseEvent) => ({
      x: e.clientX / window.innerWidth,
      y: e.clientY / window.innerHeight,
    });
    const onPointerDown = (e: MouseEvent) => {
      pointerDown = true;
      lastPointer = normPos(e);
      this.state.pointer = { ...lastPointer };
    };
    const onPointerMove = (e: MouseEvent) => {
      const p = normPos(e);
      this.state.pointer = { ...p };
      if (pointerDown) {
        this.state.interactions.push({
          type: 'drag',
          x: p.x, y: p.y,
          dx: p.x - lastPointer.x, dy: p.y - lastPointer.y,
        });
        lastPointer = p;
      }
    };
    const onPointerUp = (e: MouseEvent) => {
      if (!pointerDown) return;
      pointerDown = false;
      const p = normPos(e);
      this.state.interactions.push({ type: 'tap', x: p.x, y: p.y, dx: 0, dy: 0 });
    };
    const onBlur = () => {
      this.keyState.clear();
      this.state.moveAxis = { x: 0, y: 0 };
      this.state.pressed = { attack: false, dodge: false, skill: false, interact: false };
      this.state.interactions = [];
      pointerDown = false;
    };

    el.addEventListener('keydown', onKeyDown as EventListener);
    el.addEventListener('keyup', onKeyUp as EventListener);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('blur', onBlur);
    this.disposers.push(
      () => {
        el.removeEventListener('keydown', onKeyDown as EventListener);
        el.removeEventListener('keyup', onKeyUp as EventListener);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mousedown', onPointerDown);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('blur', onBlur);
      },
    );
  }

  /** 每帧读取前调用：从按键状态聚合移动轴向 + 重置消费式按键 + 读取 lookAxis 增量 */
  update(): void {
    let x = 0, y = 0;
    for (const [code, down] of this.keyState) {
      if (!down) continue;
      const dir = KEY_MAP[code];
      if (!dir) continue;
      if (dir.x) x += dir.x;
      if (dir.y) y += dir.y;
    }
    this.state.moveAxis = { x, y };
    // lookAxis：读出的增量即本帧值（消费式，用完归零）
  }

  /** 消费视角增量（返回并清零 lookAxis） */
  consumeLook(): { x: number; y: number } {
    const v = { ...this.state.lookAxis };
    this.state.lookAxis = { x: 0, y: 0 };
    return v;
  }

  /** 消费攻击键（返回是否按下并清除） */
  consumeAttack(): boolean {
    const v = this.state.pressed.attack;
    this.state.pressed.attack = false;
    return v;
  }

  get input(): InputActions {
    return this.state;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
