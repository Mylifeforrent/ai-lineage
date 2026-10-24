import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AiFocus,
  AiHighlightItem,
  DatasetField,
  DatasetSummary,
  EdgeDraft,
  FieldSelection,
  LineageDataset,
  LineageEdge,
  LineageGraph,
  Session,
} from '../types';
import {
  ApiError,
  deleteEdge,
  getDatasets,
  getSubgraph,
  isAbortError,
} from '../lib/api';
import { edgeEntityKey } from '../lib/entities';
import { isAdmin, isEditor } from '../lib/roles';
import { TopBar } from './TopBar';
import { DatasetSidebar } from './DatasetSidebar';
import { LineageCanvas } from './LineageCanvas';
import { DetailPanel } from './DetailPanel';
import { EdgeDetailPanel } from './EdgeDetailPanel';
import { PreviewModal } from './PreviewModal';
import { EdgeCreateModal } from './EdgeCreateModal';
import { ConfirmDialog } from './ConfirmDialog';
import { VersionDrawer } from './VersionDrawer';
import { ImportWizardModal } from './ImportWizardModal';
import { AiAssistantDrawer } from './AiAssistantDrawer';
import { UserManagementModal } from './UserManagementModal';
import { Toast } from './Toast';
import type { ToastMessage, ToastTone } from './Toast';

interface WorkspaceProps {
  session: Session;
  onLogout: () => void;
}

function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof ApiError) return reason.message;
  return fallback;
}

export function Workspace({ session, onLogout }: WorkspaceProps) {
  const canEdit = isEditor(session.role);
  const admin = isAdmin(session.role);

  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [datasetsReloadKey, setDatasetsReloadKey] = useState(0);

  const [search, setSearch] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [hops, setHops] = useState(3);

  const [graph, setGraph] = useState<LineageGraph | null>(null);
  // AI 对话返回的子图：优先于按选中数据集拉取的 graph 显示；
  // 数据集/跳数/刷新变化时清空，回到常规子图逻辑。
  const [aiGraph, setAiGraph] = useState<LineageGraph | null>(null);
  // AI 回答声明的高亮字段（mark_highlight）：seq 区分每一轮回答，
  // fields 为空数组表示新一轮回答未声明高亮（画布应清除追踪态）。
  const [aiFieldFocus, setAiFieldFocus] = useState<{
    seq: number;
    fields: AiHighlightItem[];
  } | null>(null);
  const aiFocusSeq = useRef(0);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphReloadKey, setGraphReloadKey] = useState(0);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [fieldsExpandedIds, setFieldsExpandedIds] = useState<Set<string>>(
    () => new Set(),
  );
  // 画布过滤条件（设计方案 §5.1：置信度 / 编辑来源）
  const [minConfidence, setMinConfidence] = useState(0);
  const [hideAiEdges, setHideAiEdges] = useState(false);
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [selectedField, setSelectedField] = useState<FieldSelection | null>(
    null,
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(null);
  const [edgeStartEditing, setEdgeStartEditing] = useState(false);
  const [previewSelection, setPreviewSelection] =
    useState<FieldSelection | null>(null);

  // M3：新增边草稿、删除确认、版本抽屉、用户管理
  const [edgeDraft, setEdgeDraft] = useState<EdgeDraft | null>(null);
  const [pendingDeleteEdge, setPendingDeleteEdge] = useState<LineageEdge | null>(
    null,
  );
  const [deletingEdge, setDeletingEdge] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // 导入向导（hi-fi 06）：入口仅 editor+ 渲染
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<number | null>(null);
  const toastSeq = useRef(1);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ id: toastSeq.current, message, tone });
    toastSeq.current += 1;
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 4200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  /** 统一应用一份 GraphPayload：常规子图与 AI 出图共用同一套画布状态清理。 */
  const applyGraph = useCallback((payload: LineageGraph) => {
    setGraph(payload);
    setCollapsedIds((current) => {
      const retained = new Set(
        payload.datasets
          .map((dataset) => dataset.id)
          .filter((id) => current.has(id)),
      );
      return retained.size === current.size ? current : retained;
    });
    setFieldsExpandedIds((current) => {
      const retained = new Set(
        payload.datasets
          .map((dataset) => dataset.id)
          .filter((id) => current.has(id)),
      );
      return retained.size === current.size ? current : retained;
    });
    setSelectedField((current) => {
      if (!current) return null;
      const dataset = payload.datasets.find(
        (item) => item.id === current.dataset.id,
      );
      const field = dataset?.fields.find(
        (item) => item.name === current.field.name,
      );
      return dataset && field ? { dataset, field } : null;
    });
    setSelectedEdgeId((current) =>
      current !== null && payload.edges.some((edge) => edge.id === current)
        ? current
        : null,
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDatasetsLoading(true);
    setDatasetsError(null);

    getDatasets(session.access_token, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setDatasets(list);
        setSelectedDatasetId((current) => {
          if (current && list.some((dataset) => dataset.id === current)) {
            return current;
          }
          return list[0]?.id ?? null;
        });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setDatasetsError(
          errorMessage(reason, '无法读取数据集列表，请检查后端服务是否已启动'),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDatasetsLoading(false);
      });

    return () => controller.abort();
  }, [session.access_token, datasetsReloadKey]);

  useEffect(() => {
    // 数据集、跳数或刷新变化时退出 AI 出图覆盖，回到常规子图逻辑。
    setAiGraph(null);
    if (!selectedDatasetId) {
      setGraph(null);
      setGraphError(null);
      setGraphLoading(false);
      return;
    }

    const controller = new AbortController();
    setGraphLoading(true);
    setGraphError(null);

    getSubgraph(
      session.access_token,
      { dataset: selectedDatasetId, hops, direction: 'both' },
      controller.signal,
    )
      .then((payload) => {
        if (controller.signal.aborted) return;
        applyGraph(payload);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setGraphError(
          errorMessage(reason, '无法读取血缘子图，请稍后重试'),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setGraphLoading(false);
      });

    return () => controller.abort();
  }, [applyGraph, session.access_token, selectedDatasetId, hops, graphReloadKey]);

  /** 画布最终展示的图：AI 返回的子图优先，直到用户改变数据集/跳数或刷新。 */
  const displayGraph = aiGraph ?? graph;

  const visibleDatasets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return datasets;
    return datasets.filter(
      (dataset) =>
        dataset.id.toLowerCase().includes(query) ||
        dataset.name.toLowerCase().includes(query) ||
        (dataset.field_names ?? []).some((name) =>
          name.toLowerCase().includes(query),
        ),
    );
  }, [datasets, search]);

  // 过滤只影响画布/边列表，不改动后端返回的子图数据
  const filteredGraph = useMemo(() => {
    if (!displayGraph) return null;
    if (!minConfidence && !hideAiEdges && !confirmedOnly) return displayGraph;
    const edges = displayGraph.edges.filter((edge) => {
      if ((hideAiEdges || confirmedOnly) && edge.source === 'ai') return false;
      if (minConfidence > 0 && (edge.confidence ?? 1) < minConfidence) {
        return false;
      }
      return true;
    });
    return edges.length === displayGraph.edges.length
      ? displayGraph
      : { ...displayGraph, edges };
  }, [displayGraph, minConfidence, hideAiEdges, confirmedOnly]);

  // 边详情使用未过滤的原始子图，避免画布过滤把正在查看的边藏掉
  const selectedEdge = useMemo(
    () => displayGraph?.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [displayGraph, selectedEdgeId],
  );

  const refreshGraph = useCallback(() => {
    setAiGraph(null);
    setAiFieldFocus(null);
    setGraphReloadKey((value) => value + 1);
  }, []);

  const refreshAll = useCallback(() => {
    setAiGraph(null);
    setAiFieldFocus(null);
    setDatasetsReloadKey((value) => value + 1);
    setGraphReloadKey((value) => value + 1);
    setSelectedEdgeId(null);
    setEdgeStartEditing(false);
  }, []);

  const handleSelectDataset = useCallback((datasetId: string) => {
    setAiGraph(null);
    setAiFieldFocus(null);
    setSelectedDatasetId(datasetId);
    setSelectedField(null);
    setSelectedEdgeId(null);
    setEdgeStartEditing(false);
    setCollapsedIds(new Set());
    setFieldsExpandedIds(new Set());
    setGraphError(null);
  }, []);

  const handleHopsChange = useCallback((nextHops: number) => {
    setAiGraph(null);
    setAiFieldFocus(null);
    setHops(nextHops);
  }, []);

  const handleToggleCollapse = useCallback((datasetId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(datasetId)) next.delete(datasetId);
      else next.add(datasetId);
      return next;
    });
  }, []);

  const handleToggleFields = useCallback((datasetId: string) => {
    setFieldsExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(datasetId)) next.delete(datasetId);
      else next.add(datasetId);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    if (!displayGraph) return;
    setCollapsedIds((current) => {
      const allCollapsed = displayGraph.datasets.every((dataset) =>
        current.has(dataset.id),
      );
      if (allCollapsed) return new Set();
      return new Set(displayGraph.datasets.map((dataset) => dataset.id));
    });
  }, [displayGraph]);

  const aiFocus = useMemo<AiFocus | null>(() => {
    if (selectedField) {
      return {
        dataset: selectedField.dataset.id,
        field: selectedField.field.name,
      };
    }
    if (selectedDatasetId) return { dataset: selectedDatasetId };
    return null;
  }, [selectedField, selectedDatasetId]);

  /** AI 回答联动：切换子图并把 mark_highlight 声明交给画布做追踪高亮。 */
  const handleAiGraph = useCallback(
    (payload: LineageGraph | null, highlights?: AiHighlightItem[]) => {
      aiFocusSeq.current += 1;
      setAiFieldFocus({
        seq: aiFocusSeq.current,
        fields: highlights ?? [],
      });
      if (!payload) return;
      setAiGraph(payload);
      applyGraph(payload);
      setGraphError(null);
      showToast(
        `画布已更新：${payload.datasets.length} 个数据集 · ${payload.edges.length} 条连线`,
        'success',
      );
    },
    [applyGraph, showToast],
  );

  const handleSelectField = useCallback(
    (dataset: LineageDataset, field: DatasetField) => {
      setSelectedField({ dataset, field });
      setSelectedEdgeId(null);
      setEdgeStartEditing(false);
    },
    [],
  );

  const handleCloseField = useCallback(() => setSelectedField(null), []);

  const handleSelectEdge = useCallback(
    (edge: LineageEdge, options?: { edit?: boolean }) => {
      setSelectedField(null);
      setSelectedEdgeId(edge.id);
      setEdgeStartEditing(Boolean(options?.edit));
    },
    [],
  );

  const handleCloseEdge = useCallback(() => {
    setSelectedEdgeId(null);
    setEdgeStartEditing(false);
  }, []);

  const handleOpenPreview = useCallback((selection: FieldSelection) => {
    setPreviewSelection(selection);
  }, []);
  const handleClosePreview = useCallback(() => setPreviewSelection(null), []);

  const handleRequestDeleteEdge = useCallback((edge: LineageEdge) => {
    setPendingDeleteEdge(edge);
  }, []);

  const handleConfirmDeleteEdge = useCallback(async () => {
    if (!pendingDeleteEdge || deletingEdge) return;
    setDeletingEdge(true);
    try {
      await deleteEdge(session.access_token, pendingDeleteEdge.id);
      showToast(`已删除血缘边 #${pendingDeleteEdge.id}`, 'success');
      if (selectedEdgeId === pendingDeleteEdge.id) {
        setSelectedEdgeId(null);
        setEdgeStartEditing(false);
      }
      refreshGraph();
    } catch (reason) {
      showToast(
        reason instanceof ApiError
          ? reason.message
          : '删除血缘边失败，请稍后重试。',
        'error',
      );
    } finally {
      setDeletingEdge(false);
      setPendingDeleteEdge(null);
    }
  }, [
    deletingEdge,
    pendingDeleteEdge,
    refreshGraph,
    selectedEdgeId,
    session.access_token,
    showToast,
  ]);

  const handleConnectRequest = useCallback((draft: EdgeDraft) => {
    setEdgeDraft(draft);
  }, []);

  const handleEdgeCreated = useCallback(
    (edge: LineageEdge) => {
      setEdgeDraft(null);
      setSelectedField(null);
      setSelectedEdgeId(edge.id);
      setEdgeStartEditing(false);
      showToast(`已新增血缘边 #${edge.id}（人工补边）`, 'success');
      refreshGraph();
    },
    [refreshGraph, showToast],
  );

  const handleCanvasNotice = useCallback(
    (message: string) => showToast(message, 'error'),
    [showToast],
  );

  const handleFieldUpdated = useCallback(() => {
    refreshGraph();
  }, [refreshGraph]);

  const retryDatasets = useCallback(() => {
    setDatasetsReloadKey((value) => value + 1);
  }, []);
  const retryGraph = useCallback(() => {
    setGraphReloadKey((value) => value + 1);
  }, []);

  /** AI 出图时若原选中数据集不在子图内，用子图内节点作为画布种子。 */
  const canvasSeedId = useMemo(() => {
    if (!aiGraph) return selectedDatasetId;
    const preferred = aiFocus?.dataset;
    if (preferred && aiGraph.datasets.some((item) => item.id === preferred)) {
      return preferred;
    }
    return aiGraph.datasets[0]?.id ?? null;
  }, [aiFocus, aiGraph, selectedDatasetId]);

  const deleteDescription = pendingDeleteEdge
    ? `${edgeEntityKey(pendingDeleteEdge)}（来源 ${pendingDeleteEdge.source}）`
    : '';

  return (
    <div className="flex min-h-dvh flex-col bg-page xl:h-dvh xl:overflow-hidden">
      <TopBar
        session={session}
        search={search}
        onSearchChange={setSearch}
        datasetCount={datasets.length}
        visibleCount={visibleDatasets.length}
        hops={hops}
        onHopsChange={handleHopsChange}
        graphLoading={graphLoading}
        aiOpen={aiOpen}
        onOpenAi={() => setAiOpen(true)}
        onOpenImport={() => setImportOpen(true)}
        canImport={canEdit}
        onOpenVersions={() => setVersionsOpen(true)}
        onOpenUsers={() => {
          if (admin) setUsersOpen(true);
        }}
        onLogout={onLogout}
      />

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <DatasetSidebar
          datasets={datasets}
          visibleDatasets={visibleDatasets}
          selectedId={selectedDatasetId}
          loading={datasetsLoading}
          error={datasetsError}
          search={search}
          hops={hops}
          graph={filteredGraph}
          minConfidence={minConfidence}
          hideAiEdges={hideAiEdges}
          confirmedOnly={confirmedOnly}
          onMinConfidenceChange={setMinConfidence}
          onHideAiEdgesChange={setHideAiEdges}
          onConfirmedOnlyChange={setConfirmedOnly}
          onSelect={handleSelectDataset}
          onRetry={retryDatasets}
          onClearSearch={() => setSearch('')}
        />

        <main className="relative flex min-h-[560px] flex-1 flex-col overflow-hidden xl:min-h-0">
          <div className="relative min-h-0 flex-1">
            <LineageCanvas
              graph={filteredGraph}
              seedDatasetId={canvasSeedId}
              hops={hops}
              loading={graphLoading}
              error={graphError}
              canEdit={canEdit}
              collapsedIds={collapsedIds}
              fieldsExpandedIds={fieldsExpandedIds}
              onToggleCollapse={handleToggleCollapse}
              onToggleFields={handleToggleFields}
              onToggleAll={handleToggleAll}
              onSelectField={handleSelectField}
              onSelectEdge={handleSelectEdge}
              onRequestDeleteEdge={handleRequestDeleteEdge}
              onConnectRequest={handleConnectRequest}
              onNotice={handleCanvasNotice}
              onRetry={retryGraph}
              aiFocusFields={aiFieldFocus}
            />
          </div>
        </main>

        {selectedEdge ? (
          <EdgeDetailPanel
            edge={selectedEdge}
            token={session.access_token}
            canEdit={canEdit}
            startEditing={edgeStartEditing}
            onClose={handleCloseEdge}
            onRequestDelete={handleRequestDeleteEdge}
            onRefresh={handleFieldUpdated}
            onNotify={showToast}
          />
        ) : (
          <DetailPanel
            selection={selectedField}
            graph={filteredGraph}
            token={session.access_token}
            canEdit={canEdit}
            onClose={handleCloseField}
            onPreview={handleOpenPreview}
            onRefresh={handleFieldUpdated}
            onNotify={showToast}
          />
        )}
      </div>

      {previewSelection && (
        <PreviewModal
          key={`${previewSelection.dataset.id}.${previewSelection.field.name}`}
          selection={previewSelection}
          token={session.access_token}
          onClose={handleClosePreview}
        />
      )}

      {edgeDraft && (
        <EdgeCreateModal
          key={`${edgeDraft.from_dataset}.${edgeDraft.from_field ?? '*'}-${edgeDraft.to_dataset}.${edgeDraft.to_field ?? '*'}`}
          draft={edgeDraft}
          token={session.access_token}
          onClose={() => setEdgeDraft(null)}
          onCreated={handleEdgeCreated}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDeleteEdge)}
        title="删除血缘边"
        danger
        busy={deletingEdge}
        confirmLabel="确认删除"
        message={
          <div className="space-y-1.5">
            <p className="break-all font-mono text-[11px] text-ink-soft">
              {deleteDescription}
            </p>
            <p>删除会写入变更日志；如需恢复，可由管理员回滚到之前的版本标签。</p>
          </div>
        }
        onConfirm={handleConfirmDeleteEdge}
        onCancel={() => {
          if (!deletingEdge) setPendingDeleteEdge(null);
        }}
      />

      {versionsOpen && (
        <VersionDrawer
          token={session.access_token}
          role={session.role}
          onClose={() => setVersionsOpen(false)}
          onDataChanged={refreshAll}
          onNotify={showToast}
        />
      )}

      {importOpen && canEdit && (
        <ImportWizardModal
          token={session.access_token}
          onClose={() => setImportOpen(false)}
          onCompleted={() => {
            setImportOpen(false);
            refreshAll();
          }}
          onOpenVersions={() => {
            setImportOpen(false);
            setVersionsOpen(true);
          }}
          onNotify={showToast}
        />
      )}

      <AiAssistantDrawer
        open={aiOpen}
        token={session.access_token}
        focus={aiFocus}
        onClose={() => setAiOpen(false)}
        onGraph={handleAiGraph}
      />

      {usersOpen && admin && (
        <UserManagementModal
          token={session.access_token}
          currentUsername={session.username}
          onClose={() => setUsersOpen(false)}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
