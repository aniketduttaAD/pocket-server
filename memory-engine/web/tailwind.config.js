/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FAF7F2',
        card: '#FFFDF9',
        ink: '#2C2416',
        'ink-muted': '#6B5E4F',
        terracotta: '#C4714A',
        sage: '#6B8F71',
        border: '#E8DFD0',
        tape: '#F5E6C8',
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        polaroid: '0 4px 20px rgba(44, 36, 22, 0.08), 0 1px 3px rgba(44, 36, 22, 0.06)',
        journal: '0 8px 32px rgba(44, 36, 22, 0.1)',
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}
