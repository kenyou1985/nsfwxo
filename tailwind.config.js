/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#f5f5f7',
          surface: '#ffffff',
          elevated: '#f0f0f4',
          hover: '#eaeaee',
        },
        border: {
          DEFAULT: '#d2d2d7',
          light: '#e5e5ea',
        },
        primary: {
          DEFAULT: '#0071e3',
          hover: '#0077ed',
          light: '#e8f3fd',
          muted: '#6ba8e8',
        },
        secondary: {
          DEFAULT: '#34c759',
        },
        accent: {
          DEFAULT: '#ff375f',
        },
        text: {
          primary: '#1d1d1f',
          secondary: '#86868b',
          tertiary: '#6e6e73',
        },
        card: {
          shadow: '0 2px 12px rgba(0,0,0,0.08)',
          shadowHover: '0 4px 20px rgba(0,0,0,0.12)',
        },
      },
      fontFamily: {
        sans: ['PingFang SC', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'slide-out-right': 'slide-out-right 0.3s ease-in',
        'slide-in-bottom': 'slide-in-bottom 0.3s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-out': 'fade-out 0.3s ease-in',
      },
      keyframes: {
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-out-right': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-out': {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(8px)' },
        },
        'slide-in-bottom': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        'card': '0 2px 12px rgba(0,0,0,0.08)',
        'card-hover': '0 4px 20px rgba(0,0,0,0.12)',
        'button': '0 2px 8px rgba(0,113,227,0.25)',
      },
    },
  },
  plugins: [],
}
