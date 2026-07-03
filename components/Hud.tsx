"use client";

import type { SlotSummary } from "@/lib/feed";
import type { FeedState } from "@/lib/feedSource";

/* ambient HUD — monospace, dim, corners only. numbers annotate the scene,
 * they never become the interface. */

interface HudProps {
  feed: FeedState;
  slot: SlotSummary | null;
  tps: number;
  muted: boolean;
  onToggleSound: () => void;
  toast: { amountSol: number; id: number } | null;
}

const DOT: Record<FeedState["mode"], string> = {
  live: "bg-emerald-400",
  hybrid: "bg-amber-400",
  synthetic: "bg-violet-400",
};

const feeLevel = (slot: SlotSummary | null): string => {
  if (!slot?.feeLamports || !slot.txCount) return "—";
  const priority = slot.feeLamports / slot.txCount - 5000; // 5000 = base fee
  if (priority < 2_000) return "low";
  if (priority < 20_000) return "elevated";
  return "high";
};

const Hud = ({ feed, slot, tps, muted, onToggleSound, toast }: HudProps) => (
  <div className="pointer-events-none absolute inset-0 font-mono text-xs text-white/50">
    {/* top-left: wordmark + feed mode */}
    <div className="absolute left-6 top-6">
      <p className="tracking-[0.3em] text-white/80">HEARTBEAT</p>
      <p className="mt-1">
        <span className={feed.mode === "live" ? "text-emerald-300/80" : ""}>
          {feed.label}
        </span>
        {feed.mode !== "live" && (
          <span className="ml-2 rounded border border-white/20 px-1 py-px text-[10px] uppercase text-white/40">
            {feed.mode}
          </span>
        )}
      </p>
    </div>

    {/* top-right: connection + fee pressure */}
    <div className="absolute right-6 top-6 text-right">
      <p className="flex items-center justify-end gap-2">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[feed.mode]}`} />
        <span>{feed.mode === "live" ? "connected" : feed.mode}</span>
      </p>
      <p className="mt-1">fees {feeLevel(slot)}</p>
    </div>

    {/* bottom-left: one sentence + sound toggle */}
    <div className="absolute bottom-6 left-6">
      <p>every light is a transaction</p>
      <button
        type="button"
        onClick={onToggleSound}
        className="pointer-events-auto mt-2 rounded border border-white/15 px-2 py-1 text-white/40 transition-colors hover:border-white/40 hover:text-white/80"
      >
        {muted ? "sound off" : "sound on"}
      </button>
    </div>

    {/* bottom-right: slot / tps */}
    {slot && (
      <div className="absolute bottom-6 right-6 text-right">
        <p className="text-white/80">slot {slot.slot.toLocaleString()}</p>
        <p className="mt-1">
          {Math.round(tps).toLocaleString()} tps · {slot.txCount} tx / slot
        </p>
      </div>
    )}

    {/* whale toast — brief, center-bottom */}
    {toast && (
      <p
        key={toast.id}
        className="hb-toast absolute inset-x-0 bottom-16 text-center text-sm text-amber-200/90"
      >
        ◆ {Math.round(toast.amountSol).toLocaleString()} SOL whale
      </p>
    )}
  </div>
);

export default Hud;
