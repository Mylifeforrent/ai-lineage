interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Clew 品牌图形：一团缠绕的线 + 一根引向右下角的线头。
 * 深橙底（currentColor，随上下文 text-brand-* 取色），
 * 线团用浅橙两档制造缠绕层次，线头端点即「溯源的源头」。
 */
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
      {/* 线团本体 */}
      <circle cx="18.5" cy="18.5" r="9" stroke="#FB923C" strokeWidth="1.7" />
      {/* 缠绕弧线：两浅一深，制造绕线层次 */}
      <path
        d="M10.2 16.8Q18.5 11.2 26.8 16.8"
        stroke="#FFEDD5"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M9.6 20.4Q18.5 26.2 27.4 20.4"
        stroke="#FFEDD5"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M13.4 11.4Q19.6 18.5 13.6 25.8"
        stroke="#FB923C"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      {/* 线头：从线团引出，端点即源头 */}
      <path
        d="M26.2 24.6Q30.5 27.5 33 31.5"
        stroke="#FFEDD5"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="33.4" cy="32.4" r="1.7" fill="#FFEDD5" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={compact ? 30 : 34} className="text-brand-800" />
      <div className="leading-none">
        <div className="font-sans text-base font-semibold tracking-tight text-ink">
          Clew<span className="text-brand-500">.</span>
        </div>
        {!compact && (
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            字段级血缘 · 顺线溯源
          </div>
        )}
      </div>
    </div>
  );
}
