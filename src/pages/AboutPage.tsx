import { Link } from 'react-router-dom';
import { ArrowRight, CarFront, FileCheck2, MapPin, ShieldCheck } from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';
import { HERO_IMAGE } from '../data/vehicles';
import { VehicleImage } from '../components/VehicleImage';

const PILLARS = [
  {
    icon: CarFront,
    title: 'Maintained Everyday Fleet',
    description:
      'From agile Swift hatchbacks to spacious Baleno and Hyundai i20 cars, every vehicle is serviced on schedule for reliable Telangana highway and town driving.',
  },
  {
    icon: ShieldCheck,
    title: 'Transparent Daily Rates',
    description:
      'Straightforward per-day pricing in Indian Rupees without surprise hidden add-ons, so families and working professionals can plan trips clearly.',
  },
  {
    icon: FileCheck2,
    title: 'Simple Documentation',
    description:
      'Bring your original valid Driving License and Government Photo ID (Aadhaar or Passport) for a quick verification at handover.',
  },
];

export function AboutPage() {
  return (
    <div className="bg-white">
      {/* Intro Split */}
      <section className="border-b border-slate-200 bg-slate-50/70">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1D4ED8] sm:text-sm">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{BUSINESS_CONFIG.serviceArea}</span>
              </div>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#0B1F3A] sm:text-4xl text-balance">
                About {BUSINESS_CONFIG.name}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                {BUSINESS_CONFIG.name} provides clean, reliable self-drive vehicles for residents, visiting families,
                and professionals in Siddipet, Telangana. We focus on giving you the freedom to drive yourself—whether
                for a local family occasion, temple visit, business trip, or weekend drive to Hyderabad.
              </p>
              <div className="mt-7 flex flex-wrap gap-4">
                <Link
                  to="/cars"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0B1F3A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
                >
                  <span>Explore Our Cars</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  to="/contact"
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50"
                >
                  Contact Us
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <VehicleImage
                  src={HERO_IMAGE}
                  alt="Self drive car overlooking lakeside road in Telangana"
                  aspectClassName="aspect-[16/9]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Service Pillars */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl font-bold tracking-tight text-[#0B1F3A] sm:text-3xl">
            Built Around Practical Self-Drive Travel
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">
            Every handover is structured for clarity, vehicle safety, and respectful customer service in Siddipet.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div key={pillar.title} className="rounded-xl border border-slate-200 bg-white p-6">
                <Icon className="h-6 w-6 text-[#1D4ED8]" aria-hidden="true" />
                <h3 className="mt-4 font-display text-lg font-bold text-[#0B1F3A]">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{pillar.description}</p>
              </div>
            );
          })}
        </div>

        {/* Checklist */}
        <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold text-[#0B1F3A]">What to Bring at Pickup</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="font-semibold text-[#0B1F3A]">01. Original Driving License</p>
              <p className="mt-1 text-slate-600">Valid Indian LMV driving license held by the primary driver.</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="font-semibold text-[#0B1F3A]">02. Government Photo ID</p>
              <p className="mt-1 text-slate-600">Original Aadhaar Card or Passport for KYC verification.</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="font-semibold text-[#0B1F3A]">03. Pre-Trip Inspection</p>
              <p className="mt-1 text-slate-600">Walkaround fuel and exterior check completed together at pickup.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
