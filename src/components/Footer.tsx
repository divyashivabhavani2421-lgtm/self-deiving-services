import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';
import { FEATURED_VEHICLES } from '../data/vehicles';
import { WhatsAppButton } from './WhatsAppButton';

export function Footer() {
  const currentYear = new Date().getFullYear();

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

          {/* Popular Fleet */}
          <div>
            <h2 className="font-display text-sm font-semibold text-white">Popular Fleet</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {FEATURED_VEHICLES.map((car) => (
                <li key={car.id}>
                  <Link to={`/cars/${car.slug}`} className="transition-colors hover:text-white">
                    {car.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/cars" className="text-blue-300 transition-colors hover:text-white">
                  View Full Fleet
                </Link>
              </li>
            </ul>
          </div>

          {/* Account & Direct Inquiry */}
          <div className="space-y-4">
            <h2 className="font-display text-sm font-semibold text-white">Customer Access</h2>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link to="/login" className="transition-colors hover:text-white">
                  Customer Login
                </Link>
              </li>
              <li>
                <Link to="/register" className="transition-colors hover:text-white">
                  Create Account
                </Link>
              </li>
            </ul>
            <div className="pt-2">
              <WhatsAppButton
                label="WhatsApp Inquiry"
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
