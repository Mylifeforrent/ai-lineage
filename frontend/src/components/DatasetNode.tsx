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
import { useI18n } from '../i18n';

export interface DatasetNodeData extends Record<string, unknown> {
  dataset: LineageDataset;
  collapsed: boolean;
  isSeed: boolean;
  fieldsExpanded: boolean;
  /** editor+ 才允许从 handle 拖出新血缘；viewer 的 handle 不可连接 */
  connectable: boolean;
  /** 02 §3.4：是任一 AI 候选边端点的字段名列表（纯展示派生，驱动字段行 sparkles 徽标） */
  aiEndpointFields?: string[];
  /** 字段追踪：链路上的关联字段名列表（浅红底） */
  chainFieldNames?: string[];
  /** 字段追踪：聚焦字段名列表（强红底；点击或 AI 声明，可为多个） */
  focusedFieldNames?: string[];
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
    aiEndpointFields,
    chainFieldNames,
    focusedFieldNames,
    onToggleCollapse,
    onToggleFields,
    onSelectField,
  } = nodeData;
  const { t } = useI18n();
  const fieldCount = dataset.fields.length;
  const visibleFields = fieldsExpanded
    ? dataset.fields
    : dataset.fields.slice(0, FIELD_PREVIEW_LIMIT);
  const hiddenCount = fieldCount - visibleFields.length;

  return (
    <article
      className={`dataset-card group/dataset relative w-[288px] rounded-xl border border-line-strong bg-card transition-shadow duration-150 ${
        isSeed
          ? 'shadow-node-active'
          : 'shadow-node hover:shadow-card'
      }`}
      aria-label={t('datasetNode.aria', { name: dataset.name || dataset.id, count: fieldCount })}
    >
      <span
        className={`pointer-events-none absolute inset-x-5 top-0 z-10 h-[2px] rounded-b-full ${
          isSeed ? 'bg-brand-600/80' : 'bg-line-strong/70'
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
        className={`relative flex h-14 items-center gap-2 rounded-t-xl border-b px-2.5 ${
          isSeed
            ? 'border-brand-200 bg-brand-50'
            : 'border-line-soft bg-subtle'
        }`}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse(dataset.id);
          }}
          className="nodrag nopan flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors duration-150 hover:bg-card hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1"
          aria-label={
            collapsed
              ? t('datasetNode.expandFields', { id: dataset.id })
              : t('datasetNode.collapseFields', { id: dataset.id })
          }
          title={
            collapsed
              ? t('datasetNode.expandFieldsTitle')
              : t('datasetNode.collapseFieldsTitle')
          }
        >
          <Icon
            name={collapsed ? 'chevron-right' : 'chevron-down'}
            size={13}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3
              className="truncate text-[13px] font-medium text-ink"
              title={dataset.name || dataset.id}
            >
              {dataset.name || dataset.id}
            </h3>
            {isSeed && (
              <span className="shrink-0 rounded-full border border-brand-200 bg-card px-1.5 py-px font-mono text-[11px] uppercase text-brand-800">
                {t('datasetNode.seed')}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span
              className="truncate font-mono text-[11px] text-ink-faint"
              title={dataset.id}
            >
              {dataset.id}
            </span>
            <span className="h-[2px] w-[2px] shrink-0 rounded-full bg-line-strong" />
            <span className="shrink-0 font-mono text-[11px] text-ink-faint">
              {t('datasetNode.fieldCount', { count: fieldCount })}
            </span>
          </div>
        </div>

        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
            isSeed
              ? 'border-brand-200 bg-card text-brand-700'
              : 'border-line-soft bg-card/60 text-ink-faint'
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
            className="nodrag nopan flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line text-[12px] text-ink-muted transition-colors duration-150 hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60"
          >
            <Icon name="unfold-all" size={12} />
            {t('datasetNode.expandAll', { count: fieldCount })}
          </button>
        </div>
      ) : (
        <div className="px-1.5 py-1.5">
          {fieldCount === 0 ? (
            <div className="flex h-[42px] items-center justify-center gap-1.5 rounded-md border border-dashed border-line-soft text-[12px] text-ink-faint">
              <Icon name="info" size={12} />
              {t('datasetNode.noFields')}
            </div>
          ) : (
            <>
              {visibleFields.map((field) => {
                const isFocused =
                  focusedFieldNames?.includes(field.name) ?? false;
                const isLinked =
                  !isFocused && (chainFieldNames?.includes(field.name) ?? false);
                const traced = isFocused || isLinked;
                const rowTone = isFocused
                  ? 'bg-brand-50 ring-1 ring-inset ring-brand-300/80 hover:bg-brand-100/70'
                  : isLinked
                    ? 'bg-brand-50/70 hover:bg-brand-100/50'
                    : 'hover:bg-subtle/70';
                return (
                  <div
                    key={field.name}
                    className={`group/field relative flex h-[34px] items-center rounded-md px-2 transition-colors duration-150 ${rowTone}`}
                  >
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={fieldTargetHandle(field.name)}
                      className={`field-handle${traced ? ' field-handle-traced' : ''}`}
                      style={{ top: '50%' }}
                      isConnectable={connectable}
                    />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectField(dataset, field);
                      }}
                      className="nodrag nopan flex h-full w-full min-w-0 items-center justify-between gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
                      aria-label={t('datasetNode.viewField', { id: `${dataset.id}.${field.name}` })}
                      title={t('datasetNode.fieldTitle', { desc: field.description || field.name })}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {isFocused && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={`min-w-0 truncate font-mono text-[11px] font-medium transition-colors duration-150 ${
                            isFocused
                              ? 'text-brand-700'
                              : isLinked
                                ? 'text-brand-700/90'
                                : 'text-ink-soft group-hover/field:text-brand-800'
                          }`}
                        >
                          {field.name}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="shrink-0 rounded border border-line-soft bg-page/60 px-1 py-px font-mono text-[11px] uppercase text-ink-faint">
                          {field.field_type || '—'}
                        </span>
                        {aiEndpointFields?.includes(field.name) && (
                          <span
                            className="text-ai"
                            title={t('datasetNode.aiCandidate')}
                            aria-hidden="true"
                          >
                            <Icon name="sparkles" size={12} />
                          </span>
                        )}
                      </span>
                    </button>
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={fieldSourceHandle(field.name)}
                      className={`field-handle${traced ? ' field-handle-traced' : ''}`}
                      style={{ top: '50%' }}
                      isConnectable={connectable}
                    />
                  </div>
                );
              })}
              {fieldCount > FIELD_PREVIEW_LIMIT && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFields(dataset.id);
                  }}
                  className="nodrag nopan flex h-[26px] w-full items-center gap-1.5 rounded-md px-2 text-[11px] text-ink-faint transition-colors duration-150 hover:bg-brand-50/60 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60"
                  aria-expanded={fieldsExpanded}
                  title={
                    fieldsExpanded
                      ? t('datasetNode.foldToLimit', { count: FIELD_PREVIEW_LIMIT })
                      : t('datasetNode.expandRest', { count: hiddenCount })
                  }
                >
                  <Icon
                    name={fieldsExpanded ? 'fold-all' : 'chevron-right'}
                    size={11}
                  />
                  {fieldsExpanded
                    ? t('datasetNode.foldToLimit', { count: FIELD_PREVIEW_LIMIT })
                    : t('datasetNode.restFolded', { count: hiddenCount })}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
