/** app.* 字典：应用壳层文案。 */
export const zhApp = {
  'app.sessionExpired': '登录已过期，请重新登录后继续。',
} as const;

export type AppKey = keyof typeof zhApp;

export const enApp: Record<AppKey, string> = {
  'app.sessionExpired': 'Your session has expired. Please sign in again.',
};
