'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}
function BarsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="10" />
      <line x1="12" y1="21" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="14" />
    </svg>
  );
}
function UsageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9" />
      <path d="M3 3v6h6" />
    </svg>
  );
}
function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="15" r="4" />
      <path d="M10.5 12.5 20 3M17 6l3 3M20 3l1 1" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" />
      <line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.2" y1="19.8" x2="5.6" y2="18.4" />
      <line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function initialsOf(login: string): string {
  return login.slice(0, 2).toUpperCase();
}

function NavLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className={`nav-item${active ? ' active' : ''}`}>
      {icon}
      {children}
    </Link>
  );
}

function NavStub({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="nav-item disabled">
      {icon}
      {children}
      <span className="stub-tag">Next</span>
    </div>
  );
}

export function Shell({ login, children }: { login: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    const stamped = document.documentElement.getAttribute('data-theme');
    setIsDark(stamped ? stamped === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);

  function toggleTheme() {
    const next = !isDark;
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    setIsDark(next);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-btn menu-btn" aria-label="Toggle navigation" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((v) => !v)}>
            <MenuIcon />
          </button>
          <div className="wordmark">
            <span className="wordmark-name">Tollbooth</span>
            <span className="wordmark-sub">Gateway</span>
          </div>
        </div>
        <div className="topbar-right">
          <button className="icon-btn" aria-label="Toggle theme" onClick={toggleTheme}>
            {isDark ? <MoonIcon /> : <SunIcon />}
          </button>
          <div className="tenant-chip">
            <span className="avatar">{initialsOf(login)}</span>
            <span className="tenant-login mono">@{login}</span>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="btn btn-ghost" type="submit" style={{ padding: '5px 10px', fontSize: 12 }}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="shell">
        {drawerOpen && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />}
        <nav className={`sidebar${drawerOpen ? ' open-drawer' : ''}`}>
          <div className="sidebar-section-label">Dashboard</div>
          <NavLink href="/" active={pathname === '/'} icon={<GridIcon />}>
            Overview
          </NavLink>
          <NavStub icon={<BarsIcon />}>Revenue</NavStub>
          <NavStub icon={<UsageIcon />}>Usage</NavStub>
          <div className="sidebar-section-label">Configure</div>
          <NavLink href="/tokens" active={pathname === '/tokens'} icon={<KeyIcon />}>
            Ingest tokens
          </NavLink>
          <NavStub icon={<GearIcon />}>Settings</NavStub>
        </nav>

        <main className="content">
          <div className="content-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
