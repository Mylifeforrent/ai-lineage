/** langToggle.* 字典。 */
export const zhLangToggle = {
  'langToggle.label': '切换语言',
  // 语言名用原文名（两种 locale 下一致），选择器里自我标识
  'langToggle.zhName': '中文',
  'langToggle.enName': 'English',
} as const;

export type LangToggleKey = keyof typeof zhLangToggle;

export const enLangToggle: Record<LangToggleKey, string> = {
  'langToggle.label': 'Switch language',
  'langToggle.zhName': '中文',
  'langToggle.enName': 'English',
};
