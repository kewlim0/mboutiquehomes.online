// Tailwind settings for the /tracker/ pages. The styles are built ahead of time into public/tracker-ui.css
// (npm run build:tracker-css) instead of being generated in the browser on every page load.
module.exports = {
  content: ['./private/tracker/**/*.html', './public/tracker-slide.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'PingFang SC', 'Noto Sans SC', 'sans-serif'] },
      colors: { brand: { 50: '#f0f5ff', 100: '#e0ebff', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' } },
      boxShadow: {
        'soft-lg': '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
        'game-btn': '0 4px 0 0 #2563eb, 0 6px 12px rgba(37, 99, 235, 0.3)',
        'card-glow': '0 0 20px rgba(59, 130, 246, 0.15)',
      },
    },
  },
};
