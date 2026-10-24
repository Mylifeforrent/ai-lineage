/** brand.* 字典：品牌词标副标语。 */
export const zhBrand = {
  'brand.tagline': '字段级血缘 · 顺线溯源',
} as const;

export type BrandKey = keyof typeof zhBrand;

export const enBrand: Record<BrandKey, string> = {
  'brand.tagline': 'Field-level lineage · Follow the thread',
};
