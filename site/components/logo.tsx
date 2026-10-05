import Link from "next/link";

import { LockupHorizontalCompact } from "./lockup-horizontal-compact.generated";
import { Mark } from "./mark.generated";

/**
 * The mark alone. Generated from packages/design/logo/mark.svg — the same file
 * the favicons, app icons and social avatar are built from.
 */
export const LogoSVG = (props: React.SVGProps<SVGSVGElement>) => (
  <Mark width="22" height="24" {...props} />
);

/**
 * The header logo: the horizontal lockup, compact variant. The mark and the
 * artwork's own TOLLBOOTH wordmark, rearranged from the supplied lockup by
 * scripts/sync-generated.mjs; no letter is set in a web font.
 *
 * Compact means without METERED. The supplied lockup stacks mark, name and
 * tagline, and the name is 13% of its height, so in a header it would be a 5px
 * smudge; laid out horizontally the name is 44% of the height and reads at 11px
 * in a 26px header. METERED would still be about 4px here, so it appears only
 * where it can be read: the og:image, title cards and the end card.
 */
export const Logo = () => (
  <Link href="/" className="flex items-center" aria-label="Tollbooth home">
    <LockupHorizontalCompact className="h-[26px] w-auto text-charcoal-900 dark:text-white" />
  </Link>
);
