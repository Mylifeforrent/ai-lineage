/** format.* 字典：humanizeLocator（源文件定位器人类可读文案）分段模板。 */
export const zhFormat = {
  'format.locatorUnavailable': '定位器信息不可用',
  'format.csvSource': 'CSV 源文件',
  'format.headerQuoted': '表头「{header}」',
  'format.columnOrdinal': '第 {column} 列',
  'format.xlsxSource': 'XLSX 源文件',
  'format.sheetQuoted': '工作表「{sheet}」',
  'format.headerPath': '表头路径 {path}',
  'format.columnLetter': '{column} 列',
  'format.columnPlain': '列 {column}',
  'format.columnWithIndex': '列 {column}（第 {columnIndex} 列）',
  'format.dataRows': '数据行 {start}:{end}',
  'format.dataRowsFrom': '数据行 {start} 起',
  'format.mergedHeader': '合并表头「{value}」{range}',
  'format.mergedRange': '合并区域 {range}',
  'format.jsonSourcePath': 'JSON 源文件 · {path}',
  'format.jsonSourceMissing': 'JSON 源文件 · 路径信息缺失',
  'format.locatorType': '定位器类型「{type}」',
} as const;

export type FormatKey = keyof typeof zhFormat;

export const enFormat: Record<FormatKey, string> = {
  'format.locatorUnavailable': 'Locator information unavailable',
  'format.csvSource': 'CSV source file',
  'format.headerQuoted': 'Header "{header}"',
  'format.columnOrdinal': 'Column {column}',
  'format.xlsxSource': 'XLSX source file',
  'format.sheetQuoted': 'Sheet "{sheet}"',
  'format.headerPath': 'Header path {path}',
  'format.columnLetter': 'Column {column}',
  'format.columnPlain': 'Column {column}',
  'format.columnWithIndex': 'Column {column} (#{columnIndex})',
  'format.dataRows': 'Data rows {start}:{end}',
  'format.dataRowsFrom': 'Data rows from {start}',
  'format.mergedHeader': 'Merged header "{value}" {range}',
  'format.mergedRange': 'Merged range {range}',
  'format.jsonSourcePath': 'JSON source · {path}',
  'format.jsonSourceMissing': 'JSON source · path missing',
  'format.locatorType': 'Locator type "{type}"',
};
