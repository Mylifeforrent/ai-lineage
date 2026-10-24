import { useI18n, type MessageKey } from '../i18n';

interface SourceMeta {
  label: string;
  descKey: MessageKey;
  classes: string;
  dot: string;
}

const SOURCE_META: Record<string, SourceMeta> = {
  imported: {
    label: 'imported',
    descKey: 'sourceBadge.importedDesc',
    classes: 'border-slate-200 bg-slate-100 text-slate-700',
    dot: 'bg-slate-600',
  },
  manual: {
    label: 'manual',
    descKey: 'sourceBadge.manualDesc',
    classes: 'border-teal-200 bg-teal-50 text-teal-700',
    dot: 'bg-teal-600',
  },
  ai: {
    label: 'ai',
    descKey: 'sourceBadge.aiDesc',
    classes: 'border-ai/25 bg-ai-soft text-ai-deep',
    dot: 'bg-ai',
  },
};

const UNKNOWN_META: SourceMeta = {
  label: '',
  descKey: 'sourceBadge.unknownDesc',
  classes: 'border-line bg-card/70 text-ink-muted',
  dot: 'bg-ink-faint',
};

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
  const { t } = useI18n();
  const known = source ? SOURCE_META[source] : undefined;
  const meta = known ?? UNKNOWN_META;
  const label = known ? known.label : (source || t('sourceBadge.unknownLabel'));
  const description = t(meta.descKey);
  return (
    <span
      className={`inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] leading-none ${meta.classes} ${className}`}
      title={t('sourceBadge.title', { label, desc: description })}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      <span className="font-mono font-medium">{label}</span>
      {withDescription && (
        <span className="font-medium">· {description}</span>
      )}
    </span>
  );
}
