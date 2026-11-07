import { ImageResponse } from "next/og";
import { BRAND } from "@/shared/brand";

/*
  The installable icon: the highlighter-stripe wordmark mark. An ink square (full bleed, so
  phones can crop it to a circle or rounded square) with a marker-yellow stripe under a
  paper-coloured "s". Drawn with shapes and the font that ships with next/og, so it needs
  no network and no font files. Everything scales from the pixel size.
*/
export function appIconResponse(size: number): ImageResponse {
  // The stripe covers the lower part of the letter's line box, like the `marker` class in the app.
  const box = size * 0.62;
  const stripeWidth = size * 0.5;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BRAND.ink,
          // The letter's line box has more room above it than below, so lift the mark to look centred.
          paddingBottom: size * 0.14,
        }}
      >
        <div style={{ position: "relative", display: "flex", width: stripeWidth, height: box }}>
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: box * 0.08,
              width: stripeWidth,
              height: box * 0.34,
              borderRadius: size * 0.025,
              backgroundColor: BRAND.marker,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: stripeWidth,
              height: box,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: box,
              fontWeight: 700,
              lineHeight: 1,
              color: BRAND.paper,
            }}
          >
            s
          </div>
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      // Never changes between deploys, so browsers and CDNs may keep it for a year.
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  );
}
