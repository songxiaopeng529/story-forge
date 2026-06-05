import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forge: {
          ink: "#141414",
          canvas: "#f4f6f8",
          line: "#d7dde3",
          ember: "#c4492d",
          moss: "#4e6b52",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
