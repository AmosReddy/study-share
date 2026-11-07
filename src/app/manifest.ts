import type { MetadataRoute } from "next";
import { BRAND } from "@/shared/brand";

/** Served at /manifest.webmanifest. Public: it never reads the request, so it is built once and cached. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "study-share",
    short_name: "study-share",
    description: "Notes, previous year papers and study material for your class, organised and easy to find.",
    start_url: "/",
    display: "standalone",
    background_color: BRAND.paper,
    theme_color: BRAND.ink,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
