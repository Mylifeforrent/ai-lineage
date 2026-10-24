interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 34, className = '' }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="11" fill="currentColor" />
      <circle cx="10.5" cy="20" r="3.25" fill="#BFDBFE" />
      <circle cx="29.5" cy="11" r="3.25" fill="#FFFFFF" />
      <circle cx="29.5" cy="29" r="3.25" fill="#FFFFFF" />
      <path
        d="M13.2 18.4 26.8 12.3M13.2 21.6l13.6 6.1"
        stroke="#93C5FD"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="20" cy="20" r="1.4" fill="#FFFFFF" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={compact ? 30 : 34} className="text-blue-800" />
      <div className="leading-none">
        <div className="font-sans text-base font-semibold tracking-tight text-ink">
          Lineage<span className="text-blue-600">Lite</span>
        </div>
        {!compact && (
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            字段级血缘 · 来源可查
          </div>
        )}
      </div>
    </div>
  );
}
