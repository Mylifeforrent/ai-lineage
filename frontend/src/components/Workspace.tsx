import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DatasetField,
  DatasetSummary,
  FieldSelection,
  LineageDataset,
  LineageGraph,
  Session,
} from '../types';
import {
  ApiError,
  getDatasets,
  getSubgraph,
  isAbortError,
} from '../lib/api';
import { TopBar } from './TopBar';
import { DatasetSidebar } from './DatasetSidebar';
import { LineageCanvas } from './LineageCanvas';
import { DetailPanel } from './DetailPanel';
import { PreviewModal } from './PreviewModal';

interface WorkspaceProps {
  session: Session;
  onLogout: () => void;
}

function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof ApiError) return reason.message;
  return fallback;
}

export function Workspace({ session, onLogout }: WorkspaceProps) {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [datasetsReloadKey, setDatasetsReloadKey] = useState(0);

  const [search, setSearch] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [hops, setHops] = useState(3);

  const [graph, setGraph] = useState<LineageGraph | null>(null);
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
  const [previewSelection, setPreviewSelection] =
    useState<FieldSelection | null>(null);

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
  }, [session.access_token, selectedDatasetId, hops, graphReloadKey]);

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
    if (!graph) return null;
    if (!minConfidence && !hideAiEdges && !confirmedOnly) return graph;
    const edges = graph.edges.filter((edge) => {
      if ((hideAiEdges || confirmedOnly) && edge.source === 'ai') return false;
      if (minConfidence > 0 && (edge.confidence ?? 1) < minConfidence) {
        return false;
      }
      return true;
    });
    return edges.length === graph.edges.length ? graph : { ...graph, edges };
  }, [graph, minConfidence, hideAiEdges, confirmedOnly]);

  const handleSelectDataset = useCallback((datasetId: string) => {
    setSelectedDatasetId(datasetId);
    setSelectedField(null);
    setCollapsedIds(new Set());
    setFieldsExpandedIds(new Set());
    setGraphError(null);
  }, []);

  const handleHopsChange = useCallback((nextHops: number) => {
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
    if (!graph) return;
    setCollapsedIds((current) => {
      const allCollapsed = graph.datasets.every((dataset) =>
        current.has(dataset.id),
      );
      if (allCollapsed) return new Set();
      return new Set(graph.datasets.map((dataset) => dataset.id));
    });
  }, [graph]);

  const handleSelectField = useCallback(
    (dataset: LineageDataset, field: DatasetField) => {
      setSelectedField({ dataset, field });
    },
    [],
  );

  const handleCloseField = useCallback(() => setSelectedField(null), []);
  const handleOpenPreview = useCallback((selection: FieldSelection) => {
    setPreviewSelection(selection);
  }, []);
  const handleClosePreview = useCallback(() => setPreviewSelection(null), []);

  const retryDatasets = useCallback(() => {
    setDatasetsReloadKey((value) => value + 1);
  }, []);
  const retryGraph = useCallback(() => {
    setGraphReloadKey((value) => value + 1);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas xl:h-dvh xl:overflow-hidden">
      <TopBar
        session={session}
        search={search}
        onSearchChange={setSearch}
        datasetCount={datasets.length}
        visibleCount={visibleDatasets.length}
        hops={hops}
        onHopsChange={handleHopsChange}
        graphLoading={graphLoading}
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
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-line-strong/60 to-transparent" />
          <div className="relative min-h-0 flex-1">
            <LineageCanvas
              graph={filteredGraph}
              seedDatasetId={selectedDatasetId}
              hops={hops}
              loading={graphLoading}
              error={graphError}
              collapsedIds={collapsedIds}
              fieldsExpandedIds={fieldsExpandedIds}
              onToggleCollapse={handleToggleCollapse}
              onToggleFields={handleToggleFields}
              onToggleAll={handleToggleAll}
              onSelectField={handleSelectField}
              onRetry={retryGraph}
            />
          </div>
        </main>

        <DetailPanel
          selection={selectedField}
          graph={filteredGraph}
          onClose={handleCloseField}
          onPreview={handleOpenPreview}
        />
      </div>

      {previewSelection && (
        <PreviewModal
          key={`${previewSelection.dataset.id}.${previewSelection.field.name}`}
          selection={previewSelection}
          token={session.access_token}
          onClose={handleClosePreview}
        />
      )}
    </div>
  );
}
