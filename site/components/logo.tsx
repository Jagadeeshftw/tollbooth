import Link from "next/link";

import { Mark } from "./mark.generated";

/**
 * The barrier arm, mid-lift. Generated from packages/design/logo/mark.svg —
 * the same file the favicons and the og:image are built from, so the tab, the
 * header and a pasted link all show one mark.
 */
export const LogoSVG = (props: React.SVGProps<SVGSVGElement>) => (
  <Mark width="22" height="22" {...props} />
);

export const Logo = () => (
  <Link href="/" className="flex items-center gap-2" aria-label="Tollbooth home">
    <LogoSVG />
    <span className="text-xl font-medium tracking-tight">Tollbooth</span>
  </Link>
);
