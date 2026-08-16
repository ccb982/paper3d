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
  /** ★ 左键按住状态（长按攻击用；mouseup 释放） */
  private leftDown = false;
  private disposers: Array<() => void> = [];
  private lastMouse = { x: 0, y: 0 };
  private hasMouse = false;
  private isLocked = false;

  constructor(target?: HTMLElement | Window, lockEl?: HTMLElement) {
    this.state = createInputActions();
    const el = target ?? window;

    // ★ 指针锁定（FPS/TPS 标准）：点击画布 → 隐藏光标 + 锁定，
    //   锁定后鼠标无限移动（movementX/Y），视角可 360° 旋转
    if (lockEl) {
      lockEl.addEventListener('click', () => {
        // ★ 刚退出锁定时浏览器禁止立即重新请求（SecurityError）→ 吞掉并忽略
        const p = (lockEl.requestPointerLock as unknown as (() => Promise<void>) | undefined)?.();
        p?.catch?.(() => {});
      });
    }
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === (lockEl ?? null);
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (KEY_MAP[e.code]) {
        // 方向键/WASD 不触发页面滚动
        e.preventDefault();
      }
      if (!this.keyState.get(e.code)) {
        // 上升沿：记录按下（消费式）
        if (e.code === 'KeyJ') this.state.pressed.attack = true;
        if (e.code === 'KeyK') this.state.pressed.dodge = true;
        if (e.code === 'KeyL') this.state.pressed.skill = true;
        if (e.code === 'KeyE') this.state.pressed.interact = true;
        if (e.code === 'Space') this.state.pressed.jump = true;
        if (e.code === 'KeyF') this.state.pressed.debug = true;
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
      // ★ 锁定状态：用 movementX/Y（无限增量，不受屏幕边界限制）
      if (this.isLocked) {
        this.state.lookAxis.x += e.movementX;
        this.state.lookAxis.y += e.movementY;
        return;
      }
      // 未锁定：clientX 增量（调试/窗口模式）
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
      // ★ 左键 = 攻击：单次按下 + 按住状态（长按持续发射）
      if (e.button === 0) {
        this.state.pressed.attack = true;
        this.leftDown = true;
      }
    };
    // ★ 左键释放 → 停止按住（长按攻击用）
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.leftDown = false;
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
    const onWheel = (e: WheelEvent) => {
      // ★ 滚轮 → 缩放增量（消费式：update 后由 consumeZoom 读取）
      this.state.zoomAxis += e.deltaY;
    };
    const onBlur = () => {
      this.keyState.clear();
      this.state.moveAxis = { x: 0, y: 0 };
      this.state.pressed = { attack: false, dodge: false, skill: false, interact: false, jump: false, debug: false };
      this.state.interactions = [];
      this.state.zoomAxis = 0;
      pointerDown = false;
      this.leftDown = false;
    };

    el.addEventListener('keydown', onKeyDown as EventListener);
    el.addEventListener('keyup', onKeyUp as EventListener);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('blur', onBlur);
    this.disposers.push(
      () => {
        el.removeEventListener('keydown', onKeyDown as EventListener);
        el.removeEventListener('keyup', onKeyUp as EventListener);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mousedown', onPointerDown);
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('wheel', onWheel);
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
    // ★ held 按住状态（长按语义：如按住跳跃 = 落地连跳；按住左键/J = 持续发射）
    this.state.held = {
      attack: this.leftDown || !!this.keyState.get('KeyJ'),
      jump: !!this.keyState.get('Space'),
      dodge: !!this.keyState.get('KeyK'),
      skill: !!this.keyState.get('KeyL'),
      interact: !!this.keyState.get('KeyE'),
    };
    // lookAxis：读出的增量即本帧值（消费式，用完归零）
  }

  /** 消费视角增量（返回并清零 lookAxis） */
  consumeLook(): { x: number; y: number } {
    const v = { ...this.state.lookAxis };
    this.state.lookAxis = { x: 0, y: 0 };
    return v;
  }

  /** 消费缩放增量（返回并清零 zoomAxis） */
  consumeZoom(): number {
    const v = this.state.zoomAxis;
    this.state.zoomAxis = 0;
    return v;
  }

  /** 消费攻击键（返回是否按下并清除） */
  consumeAttack(): boolean {
    const v = this.state.pressed.attack;
    this.state.pressed.attack = false;
    return v;
  }

  /** 消费跳跃键（返回是否按下并清除） */
  consumeJump(): boolean {
    const v = this.state.pressed.jump;
    this.state.pressed.jump = false;
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
