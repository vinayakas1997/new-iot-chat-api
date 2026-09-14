/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: { 100: "#e6edf3", 300: "#b6c2cf", 400: "#8b98a5", 500: "#6e7b89", 600: "#4b5563", 700: "#2d333b", 800: "#1c2128", 900: "#14181d", 950: "#0f172a" },
        accent: { 500: "#14b8a6" },
        state: { ok: "#3fb950", warn: "#d29922", bad: "#f85149" },
      },
      fontFamily: { mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    },
  },
  plugins: [],
};
