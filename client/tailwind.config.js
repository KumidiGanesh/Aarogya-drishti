/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#123B66',
        secondary: '#2196F3',
        canvas: '#F4F9FF',
      },
      minHeight: { touch: '48px' },
      fontFamily: { sans: ['Inter', '"Noto Sans"', 'sans-serif'] },
    },
  },
  plugins: [],
};
