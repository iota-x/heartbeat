"use client";

/* first-visit overlay: one sentence, dismissed on click, remembered. */

const Overlay = ({ onDismiss }: { onDismiss: () => void }) => (
  <button
    type="button"
    onClick={onDismiss}
    className="absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center bg-black/60 font-mono text-white/90 backdrop-blur-[2px]"
  >
    <p className="max-w-md px-6 text-center text-base leading-relaxed">
      Every light is a real transaction happening on Solana right now.
    </p>
    <p className="mt-6 text-xs uppercase tracking-[0.25em] text-white/40">
      click to enter
    </p>
  </button>
);

export default Overlay;
