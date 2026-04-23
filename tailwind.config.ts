import type { Config } from "tailwindcss";

// Brand palette sourced from:
//   - `2024-FiltaUS-CA-brandguidelines.pdf`
//   - `Filta logo - 4C.eps` (authoritative source for exact blue/green)
//
// Hex values for `filta.blue` and `filta.green` are pulled directly from the
// 4C EPS so the UI matches the logo exactly. The brand guide prints slightly
// different PMS-derived CMYK values (#008FC5 / #6CB33F); we defer to the EPS.
//
// Service sub-brand colors come straight from the guideline's sub-brand table.
// Use them for pipeline stage tinting, service badges, and one-off CTAs —
// don't reuse them for unrelated chrome.

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        filta: {
          // Primary brand
          blue: "#1595C8",        // Filta Blue — logotype + primary CTAs
          "blue-dark": "#0C6E96", // hover / pressed states
          green: "#71BF3B",       // Filta Green — secondary accent
          "green-dark": "#548F2C",
          // Support
          "dark-blue": "#1F3A5F", // sub-headlines per brand guide
          "cool-gray": "#4A5568", // body copy per brand guide ("Dark Cool Gray")
          "light-blue": "#E8F4FA",// background canvas per brand guide
          muted: "#F5F7FA",
        },
        service: {
          ff: "#FFC425",          // FiltaFry    — yellow
          fb: "#6CB33F",          // FiltaBio    — green (≈ Filta Green)
          fg: "#FFE14F",          // FiltaGold   — light yellow
          fd: "#820024",          // FiltaDrain  — dark red
          fc: "#6CADDE",          // FiltaCool   — light blue
          fs: "#00A98F",          // FiltaClean  — teal (cross-sell CTA accent)
        },
      },
      fontFamily: {
        // `sans` points to the CSS variable set by next/font in layout.tsx.
        // Inter is the open-source stand-in for Proxima Nova (brand preference).
        // If you license Proxima Nova via Adobe Fonts later, swap the variable
        // source in `src/app/layout.tsx` — Tailwind classes don't need to change.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
