import { ImageResponse } from "next/og";

// favicon: the core, distilled — a violet orb mid-pulse on the void.
// generated at build time; no binary asset to get stale.

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07050d",
          borderRadius: 96,
        }}
      >
        {/* outer glow */}
        <div
          style={{
            position: "absolute",
            width: 400,
            height: 400,
            borderRadius: 400,
            background:
              "radial-gradient(circle, rgba(167,139,250,0.55) 0%, rgba(124,92,240,0.18) 45%, rgba(124,92,240,0) 70%)",
          }}
        />
        {/* shockwave ring */}
        <div
          style={{
            position: "absolute",
            width: 380,
            height: 380,
            borderRadius: 380,
            border: "10px solid rgba(167,139,250,0.35)",
          }}
        />
        {/* the core */}
        <div
          style={{
            width: 190,
            height: 190,
            borderRadius: 190,
            background:
              "radial-gradient(circle at 42% 38%, #e9e2ff 0%, #c4b5fd 35%, #7c5cf0 75%, #4c3a99 100%)",
          }}
        />
        {/* a few transactions falling in */}
        <div style={{ position: "absolute", left: 96, top: 128, width: 26, height: 26, borderRadius: 26, background: "#22d3ee" }} />
        <div style={{ position: "absolute", right: 110, top: 96, width: 20, height: 20, borderRadius: 20, background: "#e879f9" }} />
        <div style={{ position: "absolute", right: 130, bottom: 116, width: 16, height: 16, borderRadius: 16, background: "#34d399" }} />
      </div>
    ),
    size,
  );
}
