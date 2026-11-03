/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'Arial', 'sans-serif'],
      },
      colors: {
        canvas: '#f3f3f0',
        panel: '#fafaf8',
        line: '#e2e2de',
        muted: '#62625d',
        accent: '#1a73e8',
      },
    },
  },
  plugins: [],
}
