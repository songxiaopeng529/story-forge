import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./node_modules/streamdown/dist/*.js",
    "./node_modules/@streamdown/code/dist/*.js",
  ],
  theme: {
    extend: {
      colors: {
        forge: {
          // Apple-minimal neutral palette (Figma "Minimal Coding Agent")
          canvas: "#f5f5f7",
          sidebar: "#fbfbfd",
          surface: "#ffffff",
          nav: "#111111",
          line: "#d2d2d7",
          divider: "#d7dde3",
          ink: "#1d1d1f",
          muted: "#6e6e73",
          accent: "#1d1d1f",
          // status
          success: "#1f9d55",
          "success-line": "#34c759",
          "success-bg": "#f0fff6",
          dot: "#10b981",
          info: "#007aff",
          "info-bg": "#f0f7ff",
          danger: "#bf1d1d",
          "danger-bg": "#fff5f5",
          // legacy alias kept for any unconverted usages
          ember: "#1d1d1f",
        },
      },
      boxShadow: {
        forge: "0 18px 42px -24px rgba(0, 0, 0, 0.11)",
      },
    },
  },
  plugins: [],
} satisfies Config;
