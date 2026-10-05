/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          950: "#070b14",
          900: "#0b1220",
          850: "#101826",
          800: "#162033",
          700: "#1e2c44",
        },
        saffron: "#FF9933",
        india: "#138808",
        navy: "#0a2540",
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(148,163,184,0.08), 0 18px 50px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
