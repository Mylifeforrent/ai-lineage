interface SourceMeta {
  label: string;
  description: string;
  classes: string;
  dot: string;
}

const SOURCE_META: Record<string, SourceMeta> = {
  imported: {
    label: 'imported',
    description: '文件导入',
    classes: 'border-blue-200 bg-blue-50 text-blue-800',
    dot: 'bg-blue-600',
  },
  manual: {
    label: 'manual',
    description: '人工确认',
    classes: 'border-warning/25 bg-warning-soft text-warning-deep',
    dot: 'bg-warning',
  },
  ai: {
    label: 'ai',
    description: 'AI 建议',
    classes: 'border-ai/25 bg-ai-soft text-ai-deep',
    dot: 'bg-ai',
  },
};

const UNKNOWN_META: SourceMeta = {
  label: '未知',
  description: '来源未登记',
  classes: 'border-line bg-card/70 text-ink-muted',
  dot: 'bg-ink-faint',
};

export function sourceMeta(source: string | null | undefined): SourceMeta {
  if (!source) return UNKNOWN_META;
  return SOURCE_META[source] ?? {
    ...UNKNOWN_META,
    label: source,
  };
}

interface SourceBadgeProps {
  source: string | null | undefined;
  withDescription?: boolean;
  className?: string;
}

export function SourceBadge({
  source,
  withDescription = true,
  className = '',
}: SourceBadgeProps) {
  const meta = sourceMeta(source);
  return (
    <span
      className={`inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] leading-none ${meta.classes} ${className}`}
      title={`来源 ${meta.label}：${meta.description}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <span className="font-mono font-medium">{meta.label}</span>
      {withDescription && (
        <span className="font-medium">· {meta.description}</span>
      )}
    </span>
  );
}
