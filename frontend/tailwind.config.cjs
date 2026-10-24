/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* 表面 */
        page: '#F8FAFC',      // 页面/画布背景（slate-50）
        card: '#FFFFFF',      // 卡片/面板/模态表面
        subtle: '#F1F5F9',    // 次级表面：表头、代码底、hover 行（slate-100）
        /* 文字 */
        ink: {
          DEFAULT: '#0F172A', // 主文字（slate-900）
          soft: '#334155',    // 次级文字（slate-700）
          muted: '#475569',   // 辅助文字（slate-600）
          faint: '#64748B',   // 占位/禁用辅助（slate-500）
        },
        /* 边框 */
        line: {
          DEFAULT: '#E2E8F0', // 默认边框（slate-200）
          strong: '#CBD5E1',  // 强边框/hover（slate-300）
          soft: '#F1F5F9',    // 弱分隔（= subtle）
        },
        /* 主色（锚点：800=#1E40AF，500=#3B82F6） */
        blue: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        /* 语义色（DEFAULT=图标/白底文字/实心底，soft=浅底，deep=soft 底正文） */
        success: { DEFAULT: '#15803D', soft: '#F0FDF4', deep: '#166534' },
        warning: { DEFAULT: '#D97706', soft: '#FFFBEB', deep: '#B45309' },
        danger: { DEFAULT: '#DC2626', soft: '#FEF2F2', deep: '#B91C1C' },
        info: { DEFAULT: '#2563EB', soft: '#EFF6FF', deep: '#1E40AF' },
        /* AI 功能色（indigo，与主蓝区分；soft 底正文用 deep） */
        ai: { DEFAULT: '#4F46E5', soft: '#EEF2FF', deep: '#3730A3' },
        /* 血缘边来源色（getEdgeVisual 四形态专用，SVG stroke） */
        lineage: {
          imported: '#475569',        // imported 字段级（实线 1.55）
          'imported-weak': '#64748B', // imported 表级（虚线 1.4）
          manual: '#D97706',          // 人工确认
          ai: '#4F46E5',              // AI 建议（虚线+流动）
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"SFMono-Regular"', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.05), 0 2px 8px -4px rgba(15, 23, 42, 0.08)',
        node: '0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 12px -6px rgba(15, 23, 42, 0.10)',
        'node-active':
          '0 0 0 1.5px rgba(37, 99, 235, 0.55), 0 8px 24px -12px rgba(30, 64, 175, 0.35)',
        float: '0 2px 6px rgba(15, 23, 42, 0.06), 0 12px 32px -12px rgba(15, 23, 42, 0.18)',
        modal: '0 8px 24px rgba(15, 23, 42, 0.12), 0 24px 64px -16px rgba(15, 23, 42, 0.25)',
      },
      backgroundImage: {
        'dot-grid':
          'radial-gradient(circle, rgba(148, 163, 184, 0.35) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid-24': '24px 24px',
      },
      transitionTimingFunction: {
        'out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      opacity: {
        15: '0.15', 35: '0.35', 45: '0.45', 55: '0.55', 65: '0.65', 85: '0.85', 92: '0.92', 98: '0.98',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'modal-in': {
          '0%': { opacity: '0', transform: 'translateY(14px) scale(0.985)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'soft-pulse': {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '0.85' },
        },
        'drawer-in': {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 300ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 200ms ease-out both',
        'modal-in': 'modal-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'soft-pulse': 'soft-pulse 1.8s ease-in-out infinite',
        'drawer-in': 'drawer-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
