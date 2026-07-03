"use client";

/* WebGL-less fallback: a static poster with the live numbers still ticking.
 * the feed doesn't need a GPU. */

import type { SlotSummary } from "@/lib/feed";
import type { FeedState } from "@/lib/feedSource";

interface PosterProps {
  feed: FeedState;
  slot: SlotSummary | null;
  tps: number;
}

const Poster = ({ feed, slot, tps }: PosterProps) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center font-mono">
    {/* the core, remembered in CSS */}
    <div
      className="h-48 w-48 rounded-full"
      style={{
        background:
          "radial-gradient(circle, rgba(167,139,250,0.9) 0%, rgba(167,139,250,0.25) 35%, rgba(34,211,238,0.08) 60%, transparent 75%)",
        boxShadow: "0 0 120px 30px rgba(167,139,250,0.15)",
        animation: "hb-poster-pulse 0.8s ease-in-out infinite",
      }}
    />
    <p className="mt-10 max-w-sm px-6 text-center text-sm text-white/70">
      Your browser can&apos;t run WebGL, but Solana doesn&apos;t care — the
      numbers below are still live.
    </p>
    <div className="mt-8 text-center text-xs text-white/50">
      <p className="text-white/80">
        {slot ? `slot ${slot.slot.toLocaleString()}` : "connecting…"}
      </p>
      <p className="mt-1">
        {Math.round(tps).toLocaleString()} tps · {feed.label}
      </p>
    </div>
  </div>
);

export default Poster;
