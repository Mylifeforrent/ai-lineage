export interface Session {
  access_token: string;
  token_type: string;
  username: string;
  role: string;
}

export interface LoginResponse extends Session {}

export interface DatasetSummary {
  id: string;
  name: string;
  field_count: number;
  field_names: string[];
}

export interface SourceFileRef {
  id: number;
  original_name: string;
}

export interface PreviewFileRef extends SourceFileRef {
  sha256: string;
  size_bytes: number | null;
  src_type: string;
  uploaded_by: string;
}

export interface PreviewVerification {
  status: string;
  version_no: number;
  checked_by: string;
  checked_at: string;
}

export type LocatorType = 'csv' | 'xlsx' | 'json' | string;

export interface LocatorEnvelope {
  type: LocatorType | null;
  input: Record<string, unknown> | null;
  resolved: Record<string, unknown> | null;
}

export interface DatasetField {
  name: string;
  field_type: string | null;
  description: string | null;
  src_locator: LocatorEnvelope;
  source_file: SourceFileRef;
}

export interface LineageDataset {
  id: string;
  name: string;
  fields: DatasetField[];
}

export interface LineageEdge {
  from_dataset: string;
  from_field: string | null;
  to_dataset: string;
  to_field: string | null;
  transform: string | null;
  confidence: number | null;
  source: string;
  note: string | null;
}

export interface LineageGraph {
  datasets: LineageDataset[];
  edges: LineageEdge[];
}

export interface FieldSelection {
  dataset: LineageDataset;
  field: DatasetField;
}

export type PreviewCell = string | number | boolean | null;

export interface CsvPreview {
  header: string[];
  column_index: number;
  rows: PreviewCell[][];
}

export interface XlsxPreview {
  sheet: string;
  header_rows: PreviewCell[][];
  merged_ranges: string[];
  column_index: number;
  row_start: number;
  row_end: number;
  rows: PreviewCell[][];
}

export interface JsonPreview {
  json_path: string;
  hits: number;
  samples: unknown[];
}

export type FieldPreview = CsvPreview | XlsxPreview | JsonPreview;

export interface PreviewResponse {
  file: PreviewFileRef;
  verification: PreviewVerification | null;
  locator: LocatorEnvelope;
  preview: FieldPreview;
}
