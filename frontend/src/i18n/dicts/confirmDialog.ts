/** confirmDialog.* 字典：通用二次确认弹窗。 */
export const zhConfirmDialog = {
  'confirmDialog.busy': '处理中…',
} as const;

export type ConfirmDialogKey = keyof typeof zhConfirmDialog;

export const enConfirmDialog: Record<ConfirmDialogKey, string> = {
  'confirmDialog.busy': 'Working…',
};
