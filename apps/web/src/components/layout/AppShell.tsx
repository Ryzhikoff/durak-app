import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Images,
  LogOut,
  Menu,
  MessageSquareText,
  Play,
  ShieldCheck,
  Sliders,
  UserCircle2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '@/stores/auth.store';
import { useLogout } from '@/features/auth/hooks';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/Button';
import { RematchListener } from '@/features/games/RematchListener';

export function AppShell() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  // The game page needs to break out of the global 5xl reading column so the
  // felt-table arena + radial seats + fixed chat sidebar can spread across the
  // viewport. We swap the `<main>` width class only for `/games/:id` (and
  // sub-routes) — every other page keeps the centred narrow column.
  const isGameRoute = /^\/games\/[^/]+/.test(location.pathname);
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
                {user.isAdmin ? (
                  <MenuLink
                    to="/admin/rating-config"
                    icon={<Sliders className="h-4 w-4" />}
                  >
                    {t('nav.adminRatingConfig')}
                  </MenuLink>
                ) : null}
                {user.isAdmin ? (
                  <MenuLink
                    to="/admin/face-cards"
                    icon={<Images className="h-4 w-4" />}
                  >
                    {t('nav.adminFaceCards')}
                  </MenuLink>
                ) : null}
                {user.isAdmin ? (
                  <MenuLink
                    to="/admin/text-reactions"
                    icon={<MessageSquareText className="h-4 w-4" />}
                  >
                    {t('nav.adminTextReactions')}
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

        <ActiveGameBanner
          currentGameId={user.currentGameId}
          currentPath={location.pathname}
        />

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
              {user.isAdmin ? (
                <MobileNavLink
                  to="/admin/rating-config"
                  label={t('nav.adminRatingConfig')}
                />
              ) : null}
              {user.isAdmin ? (
                <MobileNavLink
                  to="/admin/text-reactions"
                  label={t('nav.adminTextReactions')}
                />
              ) : null}
              {user.isAdmin ? (
                <MobileNavLink
                  to="/admin/face-cards"
                  label={t('nav.adminFaceCards')}
                />
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

      <main
        className={clsx(
          'flex-1 px-4 py-5',
          // Game route (`/games/:id`) needs the full viewport width so the
          // felt-table arena can spread out and leave room for the radial
          // seats + the fixed chat sidebar on xl+. Every other page keeps
          // the comfortable 5xl reading column.
          isGameRoute ? 'w-full' : 'mx-auto w-full max-w-5xl',
        )}
      >
        <Outlet />
      </main>

      {/* Global rematch coordinator. Lives at the AppShell level so a session
          fired from a finished-game page can still pop the modal even after
          the user navigated away to /rating or any other route. */}
      <RematchListener />
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

/**
 * Sticky banner shown under the AppShell header whenever the user has an active
 * game (per /auth/me's `currentGameId`) but isn't currently on its page. Tapping
 * the CTA jumps them straight into `/games/<currentGameId>`. The banner self-
 * hides when:
 *   - there's no active game, or
 *   - the user already navigated to its game page.
 * Lives inside the sticky header element so it scrolls with the brand row and
 * never floats over content.
 */
function ActiveGameBanner({
  currentGameId,
  currentPath,
}: {
  currentGameId: string | null;
  currentPath: string;
}) {
  const { t } = useTranslation();
  if (!currentGameId) return null;
  // Match `/games/<id>` and `/games/<id>/...` so a sub-route still hides it.
  const gamePath = `/games/${currentGameId}`;
  if (currentPath === gamePath || currentPath.startsWith(`${gamePath}/`)) {
    return null;
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-t border-accent/30 bg-accent/15 text-text"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <Play className="h-4 w-4 text-accent" aria-hidden="true" />
          <span className="font-medium">{t('nav.activeGameBanner.title')}</span>
        </div>
        <Link to={gamePath}>
          <Button variant="primary" size="sm">
            {t('nav.activeGameBanner.cta')}
          </Button>
        </Link>
      </div>
    </div>
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
