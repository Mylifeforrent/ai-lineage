/** api.* 字典：前端 HTTP 状态码兜底文案（后端返回的 detail 原样透传，不在此翻译）。 */
export const zhApi = {
  'api.e401': '登录已过期，请重新登录',
  'api.e403': '当前账号无权执行此操作',
  'api.e404': '请求的资源不存在',
  'api.e409': '操作冲突，请检查当前状态后重试',
  'api.e422': '请求参数不合法',
  'api.eDefault': '请求失败（HTTP {status}）',
} as const;

export type ApiKey = keyof typeof zhApi;

export const enApi: Record<ApiKey, string> = {
  'api.e401': 'Your session has expired. Please sign in again.',
  'api.e403': 'Your account is not allowed to perform this action.',
  'api.e404': 'The requested resource does not exist.',
  'api.e409': 'Operation conflict. Check the current state and retry.',
  'api.e422': 'Invalid request parameters.',
  'api.eDefault': 'Request failed (HTTP {status})',
};
