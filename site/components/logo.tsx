import Link from "next/link";

import { Mark } from "./mark.generated";

/**
 * The mark alone. Generated from packages/design/logo/mark.svg — the same file
 * the favicons, app icons and social avatar are built from.
 */
export const LogoSVG = (props: React.SVGProps<SVGSVGElement>) => (
  <Mark width="22" height="24" {...props} />
);

/**
 * The header logo: the mark, with the name and tagline set in the site's own
 * type beside it.
 *
 * Not the supplied lockup, and for a measured reason. That artwork stacks the
 * mark over the name over the tagline, and the name occupies 13% of its height
 * — so at a 36px nav bar it renders about 5px tall and at 56px about 7px, when
 * a wordmark needs roughly 14px to read. Using it here would put an
 * illegible smudge in the header. The same artwork is used whole where there is
 * vertical room for it: the og:image and the video end card, where the name
 * lands at 40px and above.
 */
export const Logo = () => (
  <Link href="/" className="flex items-center gap-2.5" aria-label="Tollbooth home">
    <Mark className="h-7 w-auto text-charcoal-900 dark:text-white" />
    <span className="flex flex-col leading-none">
      <span className="text-xl font-medium tracking-tight">Tollbooth</span>
      <span className="font-mono text-[10px] tracking-[0.18em] text-gray-500 uppercase dark:text-neutral-400">
        Metered.
      </span>
    </span>
  </Link>
);
