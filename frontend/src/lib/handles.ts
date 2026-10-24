export const TABLE_TARGET_HANDLE = 'table:in';
export const TABLE_SOURCE_HANDLE = 'table:out';

export function fieldTargetHandle(fieldName: string): string {
  return `field:in:${fieldName}`;
}

export function fieldSourceHandle(fieldName: string): string {
  return `field:out:${fieldName}`;
}
