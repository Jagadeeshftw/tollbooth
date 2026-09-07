"use client";
import React, { useState } from "react";

export const CopyButton = ({ text }: { text: string }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable; the text is still selectable */
        }
      }}
      className="rounded-md border border-divide bg-white px-2 py-0.5 font-mono text-[11px] text-gray-600 transition hover:text-charcoal-900 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:text-white"
      aria-label="Copy to clipboard"
    >
      {done ? "copied" : "copy"}
    </button>
  );
};
