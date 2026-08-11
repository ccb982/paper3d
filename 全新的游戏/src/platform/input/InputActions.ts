// ============================================================
// InputActions —— 抽象输入语义（设备无关）
// ============================================================
// 游戏控制层只消费此接口，不碰具体按键/触屏。
// 桌面（WASD/鼠标）和触屏（虚拟摇杆/点击）都填充同一结构。
// 双端解耦：换设备只换 Binding，游戏代码不变。

/** 抽象交互事件（点击/长按/拖拽——桌面=鼠标，触屏=手指，语义一致） */
export interface InputInteraction {
  type: 'tap' | 'hold' | 'drag';
  /** 屏幕归一化坐标 0..1（左上原点） */
  x: number;
  y: number;
  /** 拖拽增量（drag 事件用；tap/hold 为 0） */
  dx: number;
  dy: number;
}

export interface InputActions {
  /** 移动轴向 -1..1（y 向下为正：y>0 = 向下/前，y<0 = 向上/后） */
  moveAxis: { x: number; y: number };
  /** ★ 视角轴向（鼠标增量，像素；触屏 = 拖拽增量，同语义） */
  lookAxis: { x: number; y: number };
  /** ★ 缩放输入（滚轮增量，消费式；触屏 = 双指捏合，同语义） */
  zoomAxis: number;
  /** 指针位置（屏幕归一化 0..1，左上原点；null = 无指针） */
  pointer: { x: number; y: number } | null;
  /** 按键按下（攻击/闪避/技能/交互/跳跃），消费式读取 */
  pressed: {
    attack: boolean;
    dodge: boolean;
    skill: boolean;
    interact: boolean;
    jump: boolean;
  };
  /** ★ 按住状态（持续，非消费式；长按语义用——如按住跳跃=连跳） */
  held: {
    jump: boolean;
    dodge: boolean;
    skill: boolean;
    interact: boolean;
  };
  /** ★ 交互事件队列（消费式读取；语义与设备无关，供多端复用） */
  interactions: InputInteraction[];
}

/** 创建空输入状态 */
export function createInputActions(): InputActions {
  return {
    moveAxis: { x: 0, y: 0 },
    lookAxis: { x: 0, y: 0 },
    zoomAxis: 0,
    pointer: null,
    pressed: { attack: false, dodge: false, skill: false, interact: false, jump: false },
    held: { jump: false, dodge: false, skill: false, interact: false },
    interactions: [],
  };
}

/** 消费并清空交互事件队列 */
export function drainInteractions(input: InputActions): InputInteraction[] {
  const list = input.interactions;
  input.interactions = [];
  return list;
}

/** 归一化移动轴向（斜向长度 = 1，避免斜走更快） */
export function normalizeAxis(axis: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(axis.x, axis.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: axis.x / len, y: axis.y / len };
}

/** 移动是否非零（死区处理） */
export function hasMovement(axis: { x: number; y: number }, deadZone = 0.2): boolean {
  return Math.abs(axis.x) > deadZone || Math.abs(axis.y) > deadZone;
}
