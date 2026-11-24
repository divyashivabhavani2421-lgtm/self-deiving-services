import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';
import { useAuth } from '../context/AuthContext';
import { useVehicles } from '../hooks/useVehicles';
import { WhatsAppButton } from './WhatsAppButton';

export function Footer() {
  const currentYear = new Date().getFullYear();
  const { user, signOut } = useAuth();
  const { vehicles } = useVehicles();
  const footerFleet = vehicles.slice(0, 3);

  return (
    <footer className="border-t border-slate-800 bg-[#0B1F3A] text-slate-300">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
          {/* Brand Summary */}
          <div className="space-y-4">
            <Link to="/" className="font-display text-lg font-bold tracking-tight text-white">
              {BUSINESS_CONFIG.name}
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-slate-300">
              Clean, well-maintained self-drive cars for local commutes, family travel, and weekend highway trips from
              Siddipet.
            </p>
            <div className="flex items-center gap-2 text-sm text-slate-200">
              <MapPin className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
              <span>{BUSINESS_CONFIG.serviceArea}</span>
            </div>
          </div>

          {/* Navigation */}
          <div>
            <h2 className="font-display text-sm font-semibold text-white">Quick Links</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link to="/" className="transition-colors hover:text-white">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/cars" className="transition-colors hover:text-white">
                  Available Cars
                </Link>
              </li>
              <li>
                <Link to="/about" className="transition-colors hover:text-white">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/contact" className="transition-colors hover:text-white">
                  Contact Us
                </Link>
              </li>
            </ul>
          </div>

          {/* Fleet Links */}
          <div>
            <h2 className="font-display text-sm font-semibold text-white">Self Drive Fleet</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {footerFleet.map((car) => (
                <li key={car.id}>
                  <Link
                    to={`/cars/${encodeURIComponent(car.slug || car.id)}`}
                    className="transition-colors hover:text-white"
                  >
                    {car.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/cars" className="text-blue-300 transition-colors hover:text-white">
                  Browse Available Cars
                </Link>
              </li>
            </ul>
          </div>

          {/* Instant Booking & Admin Access */}
          <div className="space-y-4">
            <h2 className="font-display text-sm font-semibold text-white">Booking &amp; Support</h2>
            <ul className="space-y-2.5 text-sm">
              {user ? (
                <>
                  <li>
                    <Link to="/dashboard" className="transition-colors hover:text-white">
                      Account Dashboard
                    </Link>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => void signOut()}
                      className="transition-colors hover:text-white"
                    >
                      Sign Out
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <Link to="/cars" className="transition-colors hover:text-white">
                      Book Without Account
                    </Link>
                  </li>
                  <li>
                    <Link to="/contact" className="transition-colors hover:text-white">
                      Pickup &amp; Trip Inquiry
                    </Link>
                  </li>
                </>
              )}
            </ul>
            <div className="pt-2">
              <WhatsAppButton
                label={`WhatsApp (${BUSINESS_CONFIG.whatsappDisplayNumber})`}
                phoneNumber="917013647034"
                variant="primary"
                className="w-full sm:w-auto"
              />
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-slate-800 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center">
          <p>
            © {currentYear} {BUSINESS_CONFIG.name}. Serving {BUSINESS_CONFIG.serviceArea}.
          </p>
          <p>Valid original Driving License & Government ID required at vehicle handover.</p>
        </div>
      </div>
    </footer>
  );
}
