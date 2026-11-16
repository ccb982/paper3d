/** 关节轴语义：全项目统一，禁止再写裸 0/1/2。
 *  0 = 侧向/外展/内外翻；1 = 扭转；2 = 屈伸/俯仰。
 */
export const AXIS = { side: 0, twist: 1, bend: 2 } as const;
export const HIP = { abduct: 0, twist: 1, flex: 2 } as const;
export const FOOT = { invert: 0, twist: 1, pitch: 2 } as const;
export const SPINE = { lateral: 0, twist: 1, flex: 2 } as const;
export const NECK = { lateral: 0, twist: 1, flex: 2 } as const;
