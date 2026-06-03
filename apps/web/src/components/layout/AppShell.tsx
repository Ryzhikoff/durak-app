import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Menu, ShieldCheck, UserCircle2, X } from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '@/stores/auth.store';
import { useLogout } from '@/features/auth/hooks';
import { Button } from '@/components/ui/Button';

export function AppShell() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user) return null;

  const onLogout = async () => {
    await logout.mutateAsync();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link
            to="/"
            className="text-lg font-bold tracking-wide text-text"
            onClick={() => setMenuOpen(false)}
          >
            {t('app.title')}
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-2 sm:flex">
            <NavLinkItem to="/" label={t('nav.home')} />
            {user.isAdmin ? (
              <NavLinkItem to="/admin" label={t('nav.admin')} icon={<ShieldCheck className="h-4 w-4" />} />
            ) : null}
            <NavLinkItem to="/profile" label={t('nav.profile')} icon={<UserCircle2 className="h-4 w-4" />} />
            <span className="ml-2 text-sm text-textMuted">{user.nickname}</span>
            <Button variant="ghost" size="sm" onClick={onLogout} aria-label={t('nav.logout')}>
              <LogOut className="h-4 w-4" />
              {t('nav.logout')}
            </Button>
          </nav>

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="sm"
            className="sm:hidden !h-10 !w-10 !p-0"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {menuOpen ? (
          <nav className="border-t border-border bg-surface px-4 py-3 sm:hidden">
            <div className="mb-2 text-sm text-textMuted">{user.nickname}</div>
            <div className="flex flex-col gap-1">
              <MobileNavLink to="/" label={t('nav.home')} onClick={() => setMenuOpen(false)} />
              {user.isAdmin ? (
                <MobileNavLink
                  to="/admin"
                  label={t('nav.admin')}
                  onClick={() => setMenuOpen(false)}
                />
              ) : null}
              <MobileNavLink
                to="/profile"
                label={t('nav.profile')}
                onClick={() => setMenuOpen(false)}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setMenuOpen(false);
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

function NavLinkItem({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
          isActive
            ? 'bg-surfaceAlt text-text'
            : 'text-textMuted hover:bg-surfaceAlt hover:text-text',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function MobileNavLink({
  to,
  label,
  onClick,
}: {
  to: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
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
