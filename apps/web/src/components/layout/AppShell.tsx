import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, LogOut, Menu, ShieldCheck, UserCircle2, X } from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '@/stores/auth.store';
import { useLogout } from '@/features/auth/hooks';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';

export function AppShell() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mobileRef = useRef<HTMLElement | null>(null);

  // Close menus on route change.
  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Close mobile menu on outside click (symmetry with desktop dropdown).
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: MouseEvent) => {
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mobileOpen]);

  if (!user) return null;

  const onLogout = async () => {
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  const profileHref = `/u/${user.id}`;

  return (
    <div className="flex min-h-screen flex-col">
      <header
        ref={mobileRef}
        className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link
            to="/"
            className="text-lg font-bold tracking-wide text-text"
            onClick={() => setMobileOpen(false)}
          >
            {t('app.title')}
          </Link>

          {/* Desktop user menu */}
          <div className="relative hidden sm:flex items-center gap-2" ref={menuRef}>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                clsx(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-surfaceAlt text-text'
                    : 'text-textMuted hover:bg-surfaceAlt hover:text-text',
                )
              }
            >
              {t('nav.home')}
            </NavLink>
            {user.isAdmin ? (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  clsx(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-surfaceAlt text-text'
                      : 'text-textMuted hover:bg-surfaceAlt hover:text-text',
                  )
                }
              >
                <ShieldCheck className="h-4 w-4" />
                {t('nav.admin')}
              </NavLink>
            ) : null}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className={clsx(
                'inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm transition-colors',
                menuOpen ? 'bg-surfaceAlt' : 'hover:bg-surfaceAlt',
              )}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Avatar src={user.avatarUrl} nickname={user.nickname} size={28} />
              <span className="max-w-[10rem] truncate">{user.nickname}</span>
              <ChevronDown className="h-4 w-4 text-textMuted" />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-border bg-surface p-1 shadow-xl"
              >
                <MenuLink to={profileHref} icon={<UserCircle2 className="h-4 w-4" />}>
                  {t('nav.profile')}
                </MenuLink>
                {user.isAdmin ? (
                  <MenuLink to="/admin" icon={<ShieldCheck className="h-4 w-4" />}>
                    {t('nav.admin')}
                  </MenuLink>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void onLogout();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text hover:bg-surfaceAlt"
                >
                  <LogOut className="h-4 w-4" />
                  {t('nav.logout')}
                </button>
              </div>
            ) : null}
          </div>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="sm"
            className="sm:hidden !h-10 !w-10 !p-0"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={t('nav.menuToggle')}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {mobileOpen ? (
          <nav className="border-t border-border bg-surface px-4 py-3 sm:hidden">
            <div className="mb-3 flex items-center gap-3">
              <Avatar src={user.avatarUrl} nickname={user.nickname} size={36} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user.nickname}</div>
                {user.isAdmin ? (
                  <div className="text-xs text-accent">{t('profile.adminBadge')}</div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <MobileNavLink to="/" label={t('nav.home')} />
              <MobileNavLink to={profileHref} label={t('nav.profile')} />
              {user.isAdmin ? (
                <MobileNavLink to="/admin" label={t('nav.admin')} />
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setMobileOpen(false);
                  void onLogout();
                }}
                className="mt-2 justify-start"
              >
                <LogOut className="h-4 w-4" />
                {t('nav.logout')}
              </Button>
            </div>
          </nav>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}

function MenuLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      role="menuitem"
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
          isActive ? 'bg-surfaceAlt text-text' : 'text-text hover:bg-surfaceAlt',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

function MobileNavLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'rounded-lg px-3 py-2 text-sm',
          isActive ? 'bg-surfaceAlt text-text' : 'text-textMuted',
        )
      }
    >
      {label}
    </NavLink>
  );
}
