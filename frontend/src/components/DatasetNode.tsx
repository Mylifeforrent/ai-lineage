import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { DatasetField, LineageDataset } from '../types';
import {
  TABLE_SOURCE_HANDLE,
  TABLE_TARGET_HANDLE,
  fieldSourceHandle,
  fieldTargetHandle,
} from '../lib/handles';
import { Icon } from './Icon';
import { FIELD_PREVIEW_LIMIT } from '../lib/layout';

export interface DatasetNodeData extends Record<string, unknown> {
  dataset: LineageDataset;
  collapsed: boolean;
  isSeed: boolean;
  fieldsExpanded: boolean;
  /** editor+ 才允许从 handle 拖出新血缘；viewer 的 handle 不可连接 */
  connectable: boolean;
  onToggleCollapse: (datasetId: string) => void;
  onToggleFields: (datasetId: string) => void;
  onSelectField: (dataset: LineageDataset, field: DatasetField) => void;
}

export type DatasetFlowNode = Node<DatasetNodeData, 'dataset'>;

export function DatasetNode({ data }: NodeProps) {
  const nodeData = data as unknown as DatasetNodeData;
  const {
    dataset,
    collapsed,
    isSeed,
    fieldsExpanded,
    connectable,
    onToggleCollapse,
    onToggleFields,
    onSelectField,
  } = nodeData;
  const fieldCount = dataset.fields.length;
  const visibleFields = fieldsExpanded
    ? dataset.fields
    : dataset.fields.slice(0, FIELD_PREVIEW_LIMIT);
  const hiddenCount = fieldCount - visibleFields.length;

  return (
    <article
      className={`dataset-card group/dataset relative w-[288px] rounded-[14px] border bg-surface shadow-node transition-shadow ${
        isSeed
          ? 'border-pine-400/80 shadow-node-active'
          : 'border-line-strong/90 hover:shadow-card'
      }`}
      aria-label={`数据集 ${dataset.name || dataset.id}，${fieldCount} 个字段`}
    >
      <span
        className={`pointer-events-none absolute inset-x-5 top-0 z-10 h-[2px] rounded-b-full ${
          isSeed ? 'bg-pine-500/80' : 'bg-line-strong/70'
        }`}
        aria-hidden="true"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={TABLE_TARGET_HANDLE}
        className="table-handle"
        style={{ top: 28 }}
        isConnectable={connectable}
      />
      <Handle
        type="source"
        position={Position.Right}
        id={TABLE_SOURCE_HANDLE}
        className="table-handle"
        style={{ top: 28 }}
        isConnectable={connectable}
      />

      <header
        className={`relative flex h-14 items-center gap-2 rounded-t-[14px] border-b px-2.5 ${
          isSeed
            ? 'border-pine-100 bg-pine-50/85'
            : 'border-line-soft bg-[#f8f5ed]'
        }`}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse(dataset.id);
          }}
          className="nodrag nopan flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-surface hover:text-pine-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
          aria-label={
            collapsed
              ? `展开 ${dataset.id} 的字段列表`
              : `收起 ${dataset.id} 的字段列表`
          }
          title={collapsed ? '展开字段列表' : '收起字段列表'}
        >
          <Icon
            name={collapsed ? 'chevron-right' : 'chevron-down'}
            size={13}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3
              className="truncate text-[12px] font-semibold tracking-[0.01em] text-ink"
              title={dataset.name || dataset.id}
            >
              {dataset.name || dataset.id}
            </h3>
            {isSeed && (
              <span className="shrink-0 rounded-full border border-pine-200 bg-surface px-1.5 py-[1px] font-mono text-[7.5px] uppercase tracking-[0.12em] text-pine-700">
                种子
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span
              className="truncate font-mono text-[8.5px] text-ink-faint"
              title={dataset.id}
            >
              {dataset.id}
            </span>
            <span className="h-[2px] w-[2px] shrink-0 rounded-full bg-line-strong" />
            <span className="shrink-0 font-mono text-[8.5px] text-ink-faint">
              {fieldCount} 个字段
            </span>
          </div>
        </div>

        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
            isSeed
              ? 'border-pine-200 bg-surface/75 text-pine-600'
              : 'border-line-soft bg-surface/55 text-ink-faint'
          }`}
          aria-hidden="true"
        >
          <Icon name="table" size={12} />
        </span>
      </header>

      {collapsed ? (
        <div className="p-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(dataset.id);
            }}
            className="nodrag nopan flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line text-[10px] text-ink-muted transition-colors hover:border-pine-300 hover:bg-pine-50/60 hover:text-pine-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
          >
            <Icon name="unfold-all" size={12} />
            展开 {fieldCount} 个字段
          </button>
        </div>
      ) : (
        <div className="px-1.5 py-1.5">
          {fieldCount === 0 ? (
            <div className="flex h-[42px] items-center justify-center gap-1.5 rounded-md border border-dashed border-line-soft text-[10px] text-ink-faint">
              <Icon name="info" size={12} />
              暂无字段
            </div>
          ) : (
            <>
              {visibleFields.map((field) => (
                <div
                  key={field.name}
                  className="group/field relative flex h-[34px] items-center rounded-md px-2 transition-colors hover:bg-pine-50/60"
                >
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={fieldTargetHandle(field.name)}
                    className="field-handle"
                    style={{ top: '50%' }}
                    isConnectable={connectable}
                  />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectField(dataset, field);
                    }}
                    className="nodrag nopan flex h-full w-full min-w-0 items-center justify-between gap-2 rounded text-left focus-visible:outline-none"
                    aria-label={`查看字段 ${dataset.id}.${field.name}`}
                    title={`${field.description || field.name} · 点击查看定位与回源预览`}
                  >
                    <span className="min-w-0 truncate font-mono text-[10.5px] font-medium text-ink-soft transition-colors group-hover/field:text-pine-800">
                      {field.name}
                    </span>
                    <span className="shrink-0 rounded border border-line-soft bg-canvas/55 px-1 py-[1px] font-mono text-[8px] uppercase tracking-[0.04em] text-ink-faint">
                      {field.field_type || '—'}
                    </span>
                  </button>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={fieldSourceHandle(field.name)}
                    className="field-handle"
                    style={{ top: '50%' }}
                    isConnectable={connectable}
                  />
                </div>
              ))}
              {fieldCount > FIELD_PREVIEW_LIMIT && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFields(dataset.id);
                  }}
                  className="nodrag nopan flex h-[26px] w-full items-center gap-1.5 rounded-md px-2 text-[9.5px] text-ink-faint transition-colors hover:bg-pine-50/60 hover:text-pine-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
                  aria-expanded={fieldsExpanded}
                  title={
                    fieldsExpanded
                      ? `收起至前 ${FIELD_PREVIEW_LIMIT} 个字段`
                      : `展开其余 ${hiddenCount} 个字段`
                  }
                >
                  <Icon
                    name={fieldsExpanded ? 'fold-all' : 'chevron-right'}
                    size={11}
                  />
                  {fieldsExpanded
                    ? `收起至前 ${FIELD_PREVIEW_LIMIT} 个字段`
                    : `其余 ${hiddenCount} 个字段已折叠`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
