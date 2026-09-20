"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * The explainer, as a poster that becomes a player on click.
 *
 * Deliberately not an iframe and not an autoplaying `<video>`: nothing but a
 * ~60KB still is fetched until someone asks for the film. The `<video>` element
 * is only mounted after the click, which is also what lets it start playing
 * immediately — the gesture that mounts it is the gesture that permits sound.
 */
export const Explainer = ({
  src = "/explainer.mp4",
  poster = "/explainer-poster.jpg",
  runtimeLabel = "2:30",
}: {
  src?: string;
  poster?: string;
  runtimeLabel?: string;
}) => {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="border-divide relative aspect-video w-full overflow-hidden rounded-xl border bg-black">
      {playing ? (
        <video
          className="h-full w-full"
          src={src}
          poster={poster}
          controls
          autoPlay
          playsInline
          preload="auto"
        >
          <track kind="captions" />
        </video>
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label="Play the explainer video"
          className="group absolute inset-0 h-full w-full cursor-pointer"
        >
          <Image
            src={poster}
            alt="Tollbooth explainer — the measurement, the flow and what is built"
            fill
            sizes="(max-width: 768px) 100vw, 800px"
            className="object-cover"
            priority={false}
          />
          <span className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/10" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-lg transition-transform group-hover:scale-105">
              {/* A triangle, nudged right so it reads as centred. */}
              <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true" className="ml-1">
                <path d="M0 0 L22 13 L0 26 Z" fill="#111111" />
              </svg>
            </span>
          </span>
          <span className="absolute bottom-3 right-3 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white">
            {runtimeLabel} · silent
          </span>
        </button>
      )}
    </div>
  );
};
