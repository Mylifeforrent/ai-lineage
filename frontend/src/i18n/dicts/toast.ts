/** toast.* 字典（由对应组件改造时填充）。 */
export const zhToast = {} as const;

export type ToastKey = keyof typeof zhToast;

export const enToast: Record<ToastKey, string> = {};
