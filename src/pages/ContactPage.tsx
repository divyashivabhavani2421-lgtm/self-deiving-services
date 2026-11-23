import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Clock, MapPin, Send } from 'lucide-react';
import { BUSINESS_CONFIG } from '../config/businessConfig';
import { useVehicles } from '../hooks/useVehicles';
import { WhatsAppButton } from '../components/WhatsAppButton';
import { getTodayInputDate } from '../utils/rentalUtils';

interface InquiryFormState {
  name: string;
  phone: string;
  preferredCar: string;
  pickupDate: string;
  message: string;
}

export function ContactPage() {
  const { vehicles } = useVehicles();

  const [form, setForm] = useState<InquiryFormState>({
    name: '',
    phone: '',
    preferredCar: '',
    pickupDate: getTodayInputDate(1),
    message: '',
  });
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!form.preferredCar && vehicles.length > 0) {
      setForm((prev) => ({ ...prev, preferredCar: vehicles[0].name }));
    }
  }, [vehicles, form.preferredCar]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const cleanedPhone = form.phone.replace(/[^0-9]/g, '');

    if (!form.name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (cleanedPhone.length < 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!form.message.trim()) {
      setError('Please enter a short message about your trip.');
      return;
    }

    setError('');
    setSubmitted(true);
  };

  const selectedCarLabel = form.preferredCar || 'a self-drive car';
  const whatsappSummary = `Hello ${BUSINESS_CONFIG.name}, my name is ${form.name || 'a customer'}. I would like to inquire about ${selectedCarLabel} on ${form.pickupDate}. ${form.message}`;

  return (
    <div className="bg-slate-50/60">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-wide text-[#1D4ED8] sm:text-sm">Get in Touch</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[#0B1F3A] sm:text-4xl">
            Contact {BUSINESS_CONFIG.name}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-600">
            Have a question about car availability, pickup timings, or required documents in Siddipet? Send us a quick
            inquiry or connect directly via WhatsApp.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Info Column */}
          <div className="space-y-6 lg:col-span-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-[#0B1F3A]">Service Location</h2>
              <div className="mt-4 space-y-4 text-sm text-slate-600">
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-[#0B1F3A]">Operating Area</p>
                    <p>{BUSINESS_CONFIG.serviceArea}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-[#0B1F3A]">Flexible Pickup & Return</p>
                    <p>Morning to evening handover slots coordinated in Siddipet based on prior confirmation.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-[#0B1F3A]">Direct WhatsApp Inquiry</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Reach out directly on WhatsApp to confirm availability for our self-drive fleet in Siddipet.
              </p>
              <div className="mt-5">
                <WhatsAppButton
                  label="Message on WhatsApp"
                  message={whatsappSummary}
                  variant="primary"
                  className="w-full justify-center"
                />
              </div>
            </div>
          </div>

          {/* Right Form Column */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
              <h2 className="font-display text-xl font-bold text-[#0B1F3A]">Send a Rental Inquiry</h2>
              <p className="mt-1 text-sm text-slate-600">
                Share your preferred model and travel date. No payment is collected on this form.
              </p>

              {submitted ? (
                <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/70 p-6">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#15803D]" aria-hidden="true" />
                    <div>
                      <h3 className="font-display text-base font-bold text-[#0B1F3A]">Inquiry Prepared</h3>
                      <p className="mt-1 text-sm leading-relaxed text-slate-700">
                        Thank you, <span className="font-semibold">{form.name}</span>. Your inquiry for{' '}
                        <span className="font-semibold">{selectedCarLabel}</span> ({form.pickupDate}) has been
                        validated. You can forward this inquiry directly on WhatsApp or edit your details below.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <WhatsAppButton label="Send This Inquiry on WhatsApp" message={whatsappSummary} />
                        <button
                          type="button"
                          onClick={() => setSubmitted(false)}
                          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-[#0B1F3A] transition-colors hover:bg-slate-50"
                        >
                          Edit Inquiry
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className="block text-xs font-semibold text-slate-700">
                        Full Name
                      </label>
                      <input
                        id="contact-name"
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Enter your name"
                        className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="contact-phone" className="block text-xs font-semibold text-slate-700">
                        Mobile Number
                      </label>
                      <input
                        id="contact-phone"
                        type="tel"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder="10-digit mobile number"
                        className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-car" className="block text-xs font-semibold text-slate-700">
                        Preferred Vehicle
                      </label>
                      {vehicles.length > 0 ? (
                        <select
                          id="contact-car"
                          value={form.preferredCar}
                          onChange={(e) => setForm({ ...form, preferredCar: e.target.value })}
                          className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                        >
                          {vehicles.map((car) => (
                            <option key={car.id} value={car.name}>
                              {car.name}
                              {car.transmission ? ` (${car.transmission})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id="contact-car"
                          type="text"
                          value={form.preferredCar}
                          onChange={(e) => setForm({ ...form, preferredCar: e.target.value })}
                          placeholder="e.g. Swift, Baleno, i20"
                          className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                        />
                      )}
                    </div>

                    <div>
                      <label htmlFor="contact-date" className="block text-xs font-semibold text-slate-700">
                        Preferred Pickup Date
                      </label>
                      <input
                        id="contact-date"
                        type="date"
                        min={getTodayInputDate(0)}
                        value={form.pickupDate}
                        onChange={(e) => setForm({ ...form, pickupDate: e.target.value })}
                        className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-[#0B1F3A] tabular-nums focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="contact-message" className="block text-xs font-semibold text-slate-700">
                      Trip Details / Message
                    </label>
                    <textarea
                      id="contact-message"
                      rows={4}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      placeholder="Mention your trip duration, destination from Siddipet, or any questions..."
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3.5 text-sm text-[#0B1F3A] focus:border-[#1D4ED8] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                      required
                    />
                  </div>

                  {error && (
                    <p role="alert" className="text-xs font-medium text-red-700">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-lg bg-[#0B1F3A] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    <span>Submit Inquiry</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
