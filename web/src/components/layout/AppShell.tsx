import { ROLE_LABELS } from '@rgk/core';
import { ChevronsLeft, ChevronsRight, KeyRound, LogOut, Moon, Search, Sun, UserCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Avatar, Menu, Sheet } from '@/components/ui/misc';
import { bottomNavFor, homeFor, navFor } from '@/lib/nav';
import { useMe, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { GlobalSearch } from './GlobalSearch';
import { MyDayDrawer } from './MyDayDrawer';
import { NotificationBell } from './NotificationBell';

/** Typographic brand mark. */
export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-brand shadow-[0_4px_12px_rgba(252,128,25,0.35)]">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path d="M6 12.5l3.8 3.8L18 8" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight">RGK WorkTrack</span>
          <span className="block text-[11px] text-muted-foreground">RGK Group of Industries</span>
        </span>
      )}
    </span>
  );
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('rgk-sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const me = useMe();
  const sections = navFor(me.role, me.isReporter);
  return (
    <aside className={cn('no-print sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-nav transition-[width] duration-200 lg:flex', collapsed ? 'w-[76px]' : 'w-60')}>
      <div className={cn('flex items-center py-5', collapsed ? 'justify-center px-2' : 'justify-between px-5')}>
        <Link to={homeFor(me.role)} aria-label="Home">
          <Logo compact={collapsed} />
        </Link>
      </div>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 [scrollbar-width:thin]">
        {sections.map((s) => (
          <div key={s.title}>
            {!collapsed && <p className="px-3 pb-1.5 text-[11px] font-medium text-muted-foreground">{s.title}</p>}
            <ul className="space-y-0.5">
              {s.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'tap flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-foreground/75 hover:bg-muted hover:text-foreground',
                        collapsed && 'justify-center px-0',
                        isActive && 'bg-nav-active font-medium text-nav-active-foreground hover:bg-nav-active hover:text-nav-active-foreground',
                      )
                    }
                  >
                    <item.icon className="size-[18px] shrink-0" aria-hidden />
                    {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t p-3">
        <button onClick={onToggle} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl py-2 text-[13px] text-muted-foreground hover:bg-muted" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}

function BottomNav() {
  const me = useMe();
  return (
    <nav aria-label="Main" className="no-print pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur-md lg:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {bottomNavFor(me.role).map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} className={({ isActive }) => cn('tap flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] font-medium', isActive ? 'text-primary' : 'text-muted-foreground')}>
              {({ isActive }) => (
                <>
                  <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-brand-soft')}>
                    <item.icon className="size-[20px]" strokeWidth={isActive ? 2.4 : 2} aria-hidden />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell() {
  const me = useMe();
  const { signOut } = useSession();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = me.can('directory.full') || me.can('team.view');

  useEffect(() => setSearchOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('rgk-sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      // Storage blocked: preference lasts for this page only.
    }
  }, [collapsed]);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded-xl focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="flex">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print pt-safe sticky top-0 z-30 border-b bg-background/90 backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
              <Link to={homeFor(me.role)} className="lg:hidden" aria-label="Home">
                <Logo compact />
              </Link>
              <div className="hidden min-w-0 flex-1 lg:block">{showSearch && <GlobalSearch />}</div>
              <div className="flex-1 lg:hidden" />
              {showSearch && (
                <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSearchOpen(true)} aria-label="Search">
                  <Search />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
                {theme === 'dark' ? <Sun /> : <Moon />}
              </Button>
              <NotificationBell />
              <Menu
                trigger={
                  <button className="flex cursor-pointer items-center gap-2 rounded-full p-0.5 hover:bg-muted lg:rounded-xl lg:py-1 lg:pl-1 lg:pr-3" aria-label="Account menu">
                    <Avatar name={me.user.fullName} />
                    <span className="hidden text-left leading-tight lg:block">
                      <span className="block max-w-40 truncate text-[13px] font-medium">{me.user.fullName}</span>
                      <span className="block text-[11px] text-muted-foreground">{ROLE_LABELS[me.role]}</span>
                    </span>
                  </button>
                }
                items={[
                  { label: <><UserCircle /> Profile</>, onSelect: () => navigate('/profile') },
                  { label: <><KeyRound /> Change password</>, onSelect: () => navigate('/profile#password') },
                  'separator',
                  { label: <><LogOut /> Sign out</>, onSelect: () => void signOut().then(() => navigate('/login')) },
                ]}
              />
            </div>
          </header>
          <main id="main" key={location.pathname} className="mx-auto w-full max-w-6xl flex-1 animate-fade-up px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:pb-10">
            <Outlet />
          </main>
        </div>
      </div>
      <BottomNav />
      {me.role !== 'SUPER_ADMIN' && <MyDayDrawer />}
      {showSearch && (
        <Sheet open={searchOpen} onOpenChange={setSearchOpen} title="Search">
          <div className="min-h-[50dvh] pt-1">
            <GlobalSearch autoFocus />
          </div>
        </Sheet>
      )}
    </div>
  );
}
