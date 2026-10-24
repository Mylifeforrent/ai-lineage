/** annotation.* 字典：标注区。 */
export const zhAnnotation = {
  'annotation.title': '标注（{count}）',
  'annotation.appendOnly': '追加式',
  'annotation.loadFailed': '无法读取标注，请稍后重试。',
  'annotation.loading': '正在读取标注…',
  'annotation.empty': '暂无标注',
  'annotation.inputLabel': '添加标注',
  'annotation.placeholder': '添加标注（追加式，不覆盖原值）',
  'annotation.counter': '{count}/4000 · 标注不随版本回滚删除',
  'annotation.submitting': '提交中…',
  'annotation.submit': '提交标注',
  'annotation.submitFailed': '标注提交失败，请稍后重试。',
  'annotation.readonly': '当前角色为只读，不能追加标注。',
} as const;

export type AnnotationKey = keyof typeof zhAnnotation;

export const enAnnotation: Record<AnnotationKey, string> = {
  'annotation.title': 'Annotations ({count})',
  'annotation.appendOnly': 'Append-only',
  'annotation.loadFailed': 'Cannot load annotations. Please try again later.',
  'annotation.loading': 'Loading annotations…',
  'annotation.empty': 'No annotations yet',
  'annotation.inputLabel': 'Add annotation',
  'annotation.placeholder': 'Add an annotation (append-only, never overwrites)',
  'annotation.counter': '{count}/4000 · Annotations survive version rollbacks',
  'annotation.submitting': 'Submitting…',
  'annotation.submit': 'Add',
  'annotation.submitFailed': 'Failed to submit the annotation. Please try again later.',
  'annotation.readonly': 'Your role is read-only and cannot add annotations.',
};
