"use client";

import { useState } from "react";
import Image from "next/image";

import { VIDEO_ID, VIDEO_RUNTIME, VIDEO_URL } from "@/content/measurements";

/**
 * The explainer, as a poster that becomes the YouTube player on click.
 *
 * Deliberately not an iframe on load. An embedded player is ~1MB of scripts and
 * a set of Google requests made on behalf of everyone who opens the page,
 * whether or not they ever press play; this fetches a ~60KB still instead and
 * creates the iframe only when someone asks for the film. `youtube-nocookie`
 * and a local poster mean the first request to Google happens after the click,
 * not before it.
 *
 * `autoplay=1` is safe here for the same reason: the click that mounts the
 * iframe is the gesture that permits playback — and this cut has sound, so it
 * matters that the player starts unmuted.
 */
export const Explainer = ({
  poster = "/explainer-poster.jpg",
  runtimeLabel = VIDEO_RUNTIME,
}: {
  poster?: string;
  runtimeLabel?: string;
}) => {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="border-divide relative aspect-video w-full overflow-hidden rounded-xl border bg-black">
      {playing ? (
        <iframe
          className="h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`}
          title="Tollbooth — paid MCP tools, paid for by a human, settled on any chain"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label="Play the explainer video on YouTube"
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
            {runtimeLabel}
          </span>
        </button>
      )}
      <noscript>
        <a href={VIDEO_URL} className="absolute inset-0 flex items-end justify-center p-4 text-sm text-white underline">
          Watch the explainer on YouTube
        </a>
      </noscript>
    </div>
  );
};
