import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        filta: {
          // Placeholder brand palette; replace with official Filta colors
          primary: "#003f7f",
          accent: "#ff7a00",
          muted: "#f5f7fa",
        },
      },
    },
  },
  plugins: [],
};

export default config;
