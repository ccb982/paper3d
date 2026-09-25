// 命令/指令中文化（UI 显示用；数据层仍是英文码）
export const ORDER_CN: Record<string, string> = {
  none: '无', advance: '推进', retreat: '撤退', protect: '护卫', flank: '包抄',
  bound: '跃迁', focus: '集火', regroup: '集结', garrison: '驻守',
};

export const DIRECTIVE_CN: Record<string, string> = {
  none: '无', push: '推进', suppress: '压制', screen: '掩护', fallback: '后撤', boundBack: '交替后撤',
  guardWard: '护卫', block: '拦截', intercept: '截击', sneak: '潜行', pin: '钉住', strike: '突击',
  bound: '跃进', cover: '掩体', focusFire: '集火', regroup: '收拢',
};

export const orderCn = (k?: string): string => (k ? ORDER_CN[k] ?? k : '无');
export const directiveCn = (k?: string): string => (k ? DIRECTIVE_CN[k] ?? k : '无');
export const sourceCn = (s: string): string => (s === 'engine' ? '引擎' : s === 'player' ? '玩家' : s);
