import type { MetadataRoute } from "next";

// PWA manifest — lets the sales team Add to Home Screen so Field Mode opens
// like a native app (full screen, Filta Blue splash, swoosh icon). Next
// serves this at /manifest.webmanifest and auto-links it from every page.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Filta CRM",
    short_name: "Filta",
    description:
      "Filta Fun Coast & Space Coast sales CRM — pipeline, field updates, weekly scoreboard.",
    start_url: "/field",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#1595C8",
    orientation: "portrait",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
