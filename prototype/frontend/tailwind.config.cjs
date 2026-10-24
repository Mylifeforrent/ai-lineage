/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#f3f0e7',
        surface: '#fffdf8',
        ink: {
          DEFAULT: '#1b2a25',
          soft: '#3b4d45',
          muted: '#506159',
          faint: '#66746d',
        },
        line: {
          DEFAULT: '#dcd6c9',
          strong: '#c9c2b3',
          soft: '#ece8de',
        },
        pine: {
          50: '#eef7f2',
          100: '#d7ece1',
          200: '#b3d9c7',
          300: '#83bfa6',
          400: '#519f83',
          500: '#2f8268',
          600: '#1f6753',
          700: '#1a5344',
          800: '#174237',
          900: '#13362e',
        },
        ember: {
          DEFAULT: '#b9552f',
          soft: '#f8e9df',
          deep: '#8d3e20',
        },
        ochre: {
          DEFAULT: '#a36b11',
          soft: '#fbf1d9',
          deep: '#78500c',
        },
        ai: {
          DEFAULT: '#2f64d8',
          soft: '#eaf0ff',
          deep: '#214aa3',
        },
        rosewood: {
          DEFAULT: '#9b3a43',
          soft: '#f8e8e9',
          deep: '#742b32',
        },
      },
      fontFamily: {
        sans: [
          '"Noto Sans SC"',
          '"Avenir Next"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        display: [
          '"Newsreader"',
          '"Songti SC"',
          '"Noto Serif SC"',
          'Georgia',
          'serif',
        ],
        mono: [
          '"IBM Plex Mono"',
          '"SFMono-Regular"',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        card: '0 1px 2px rgba(27, 42, 37, 0.04), 0 10px 30px -18px rgba(27, 42, 37, 0.24)',
        float: '0 18px 50px -22px rgba(19, 54, 46, 0.38)',
        node: '0 1px 2px rgba(27, 42, 37, 0.06), 0 8px 24px -18px rgba(27, 42, 37, 0.3)',
        'node-active': '0 0 0 1px rgba(31, 103, 83, 0.42), 0 12px 36px -20px rgba(19, 54, 46, 0.38)',
      },
      backgroundImage: {
        'fine-grid':
          'linear-gradient(rgba(27,42,37,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(27,42,37,0.035) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid-28': '28px 28px',
      },
      opacity: {
        15: '0.15',
        35: '0.35',
        45: '0.45',
        55: '0.55',
        65: '0.65',
        85: '0.85',
        92: '0.92',
        98: '0.98',
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
      },
      animation: {
        'fade-up': 'fade-up 420ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 260ms ease-out both',
        'modal-in': 'modal-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'soft-pulse': 'soft-pulse 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
