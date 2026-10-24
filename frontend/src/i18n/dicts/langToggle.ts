/** langToggle.* 字典。 */
export const zhLangToggle = {
  'langToggle.label': '切换语言',
} as const;

export type LangToggleKey = keyof typeof zhLangToggle;

export const enLangToggle: Record<LangToggleKey, string> = {
  'langToggle.label': 'Switch language',
};
