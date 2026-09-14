/** 00-design-rules tokens: dark-first, industrial teal, state colors. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          100: "#e7ebf3",
          300: "#b6bfd4",
          400: "#8b96b0",
          600: "#3d4a68",
          700: "#2a3347",
          800: "#1c2230",
          850: "#161b24",
          900: "#11151c",
          950: "#0b0e13",
        },
        accent: { 400: "#2dd4bf", 500: "#14b8a6" },
        state: { ok: "#22c55e", warn: "#f59e0b", bad: "#ef4444" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
