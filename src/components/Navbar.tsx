import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';

const NAV_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'Available Cars', to: '/cars' },
  { label: 'About Us', to: '/about' },
  { label: 'Contact', to: '/contact' },
];

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `relative py-1 text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1D4ED8] ${
      isActive
        ? 'text-[#1D4ED8] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[#1D4ED8]'
        : 'text-slate-600 hover:text-[#0B1F3A]'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <Link
          to="/"
          onClick={() => setMobileMenuOpen(false)}
          className="font-display text-lg font-bold tracking-tight text-[#0B1F3A] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1D4ED8]"
        >
          {BUSINESS_CONFIG.name}
        </Link>

        {/* Zone 2: Primary Navigation Links */}
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-7">
          {NAV_LINKS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Zone 3: Auth Actions + Mobile Menu Button */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden md:flex items-center gap-4">
            <NavLink
              to="/login"
              className={({ isActive }) =>
                `text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 ${
                  isActive ? 'text-[#1D4ED8]' : 'text-slate-700 hover:text-[#0B1F3A]'
                }`
              }
            >
              Login
            </NavLink>
            <Link
              to="/register"
              className="rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#1D4ED8] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
            >
              Register
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-menu"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-[#0B1F3A] transition-colors hover:bg-slate-50 md:hidden focus-visible:outline-2 focus-visible:outline-[#1D4ED8]"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div id="mobile-nav-menu" className="border-t border-slate-200 bg-white px-4 pb-5 pt-3 md:hidden">
          <nav aria-label="Mobile navigation" className="flex flex-col space-y-1">
            {NAV_LINKS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex min-h-[44px] items-center rounded-lg px-3 text-base font-medium transition-colors ${
                    isActive ? 'bg-blue-50 text-[#1D4ED8]' : 'text-slate-700 hover:bg-slate-50 hover:text-[#0B1F3A]'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <Link
              to="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50"
            >
              Login
            </Link>
            <Link
              to="/register"
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-[44px] items-center justify-center rounded-lg bg-[#0B1F3A] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
            >
              Register
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
