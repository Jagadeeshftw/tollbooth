import Link from "next/link";

/** A barrier arm on a post. Small enough to read at 20px. */
export const LogoSVG = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 22 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    <rect x="2" y="4" width="4" height="16" rx="1" fill="currentColor" />
    <path
      d="M6 9.5h13.5a1 1 0 0 1 0 2H6z"
      fill="currentColor"
    />
    <path d="M9 9.5h2.5v2H9zM14 9.5h2.5v2H14z" className="fill-brand" />
  </svg>
);

export const Logo = () => (
  <Link href="/" className="flex items-center gap-2" aria-label="Tollbooth home">
    <LogoSVG />
    <span className="text-xl font-medium tracking-tight">Tollbooth</span>
  </Link>
);
