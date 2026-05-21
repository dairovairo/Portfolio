/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        body:    ['DM Sans', 'sans-serif'],
        mono:    ['DM Mono', 'monospace'],
      },
      colors: {
        charge: {
          dead: '#ef4444',
          low:  '#f97316',
          mid:  '#eab308',
          good: '#84cc16',
          full: '#22c55e',
        },
        surface: {
          bg:     'var(--sb-bg)',
          card:   'var(--sb-card)',
          border: 'var(--sb-border)',
          hover:  'var(--sb-hover)',
          text:   'var(--sb-text)',
          muted:  'var(--sb-muted)',
        },
        accent: {
          primary: 'var(--sb-accent)',
          glow:    'var(--sb-accent-glow)',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.4s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'scale-in':   'scaleIn 0.25s ease-out',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(12px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        scaleIn: { '0%': { transform: 'scale(0.92)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
      },
    },
  },
  plugins: [],
};
