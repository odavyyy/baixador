const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), panel: v('panel'), card: v('card'), elev: v('elev'), line: v('line'),
        fg: v('fg'), muted: v('muted'), faint: v('faint'),
        accent: v('accent'), ok: v('ok'), warn: v('warn'), bad: v('bad'),
      },
      fontFamily: { sans: ['"Inter Variable"', '"Segoe UI Variable"', '"Segoe UI"', 'sans-serif'] },
      borderRadius: { xl: '12px', lg: '9px' },
      keyframes: {
        in: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        shimmer: { from: { backgroundPosition: '-400px 0' }, to: { backgroundPosition: '400px 0' } },
        stripes: { from: { backgroundPosition: '0 0' }, to: { backgroundPosition: '24px 0' } },
      },
      animation: { in: 'in .28s cubic-bezier(.2,.7,.2,1) both', shimmer: 'shimmer 1.4s linear infinite', stripes: 'stripes .8s linear infinite' },
    },
  },
  plugins: [],
};
