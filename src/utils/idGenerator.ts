let counter = 0;

/**
 * 生成唯一ID，格式：prefix_timestamp_counter
 * @param prefix 前缀，默认为 'entity'
 * @returns 唯一ID字符串
 */
export function generateId(prefix: string = 'entity'): string {
  return `${prefix}_${Date.now()}_${counter++}`;
}