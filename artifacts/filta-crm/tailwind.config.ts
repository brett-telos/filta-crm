import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        filta: {
          blue: "#1595C8",
          "blue-dark": "#0C6E96",
          green: "#71BF3B",
          "green-dark": "#548F2C",
          "dark-blue": "#1F3A5F",
          "cool-gray": "#4A5568",
          "light-blue": "#E8F4FA",
          muted: "#F5F7FA",
        },
        service: {
          ff: "#FFC425",
          fb: "#6CB33F",
          fg: "#FFE14F",
          fd: "#820024",
          fc: "#6CADDE",
          fs: "#00A98F",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;