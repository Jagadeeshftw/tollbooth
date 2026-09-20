import Link from "next/link";

import { Lockup } from "./lockup.generated";
import { Mark } from "./mark.generated";

/**
 * The mark alone. Generated from packages/design/logo/mark.svg — the same file
 * the favicons, app icons and social avatar are built from.
 */
export const LogoSVG = (props: React.SVGProps<SVGSVGElement>) => (
  <Mark width="22" height="24" {...props} />
);

/**
 * The header logo: the full lockup, so the name and the tagline are read rather
 * than inferred. One vector serves both themes — it paints in `currentColor`,
 * which is why the supplied light and dark PNGs collapse into a single file.
 */
export const Logo = () => (
  <Link href="/" className="flex items-center" aria-label="Tollbooth home">
    <Lockup className="h-9 w-auto text-charcoal-900 dark:text-white" />
  </Link>
);
