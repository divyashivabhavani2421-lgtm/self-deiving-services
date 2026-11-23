import { useState } from 'react';
import { Check, Copy, MessageCircle, X } from 'lucide-react';
import { BUSINESS_CONFIG, buildWhatsAppUrl } from '../config/businessConfig';

interface WhatsAppButtonProps {
  message?: string;
  phoneNumber?: string;
  label?: string;
  variant?: 'floating' | 'primary' | 'outline';
  className?: string;
}

export function WhatsAppButton({
  message = 'Hello Siddipet Self Drive Cars, I would like to inquire about renting a self-drive car in Siddipet.',
  phoneNumber,
  label = 'Chat on WhatsApp',
  variant = 'primary',
  className = '',
}: WhatsAppButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const effectiveNumber = phoneNumber ?? BUSINESS_CONFIG.whatsappNumber;
  const whatsappHref = buildWhatsAppUrl(message, effectiveNumber);

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const baseButtonClasses =
    variant === 'floating'
      ? 'fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2.5 rounded-full bg-[#15803D] px-5 text-sm font-semibold text-white shadow-lg transition-transform duration-200 hover:-translate-y-0.5 hover:bg-[#166534] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803D]'
      : variant === 'outline'
        ? 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-[#0B1F3A] transition-colors duration-200 hover:border-[#15803D] hover:bg-emerald-50/60 hover:text-[#166534] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803D] whitespace-nowrap shrink-0'
        : 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#15803D] px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#166534] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803D] whitespace-nowrap shrink-0';

  return (
    <>
      {whatsappHref ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className={`${baseButtonClasses} ${className}`}
        >
          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </a>
      ) : (
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          aria-label={label}
          className={`${baseButtonClasses} ${className}`}
        >
          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </button>
      )}

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1F3A]/50 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="whatsapp-config-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="whatsapp-config-title" className="font-display text-lg font-bold text-[#0B1F3A]">
                  WhatsApp Inquiry Preview
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Configure your business WhatsApp phone number to connect directly with customers in Siddipet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close modal"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0B1F3A] focus-visible:outline-2 focus-visible:outline-[#1D4ED8]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold tracking-wide text-slate-500">Prepared Inquiry Message</p>
              <p className="mt-1.5 text-sm leading-relaxed text-[#0B1F3A]">{message}</p>
            </div>

            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/70 p-3.5 text-xs leading-relaxed text-[#0B1F3A]">
              Set <code className="font-mono font-semibold text-[#1D4ED8]">VITE_WHATSAPP_NUMBER</code> in your
              environment variables (for example <code className="font-mono">9198XXXXXXXX</code>) or update{' '}
              <code className="font-mono font-semibold text-[#1D4ED8]">BUSINESS_CONFIG.whatsappNumber</code> to launch
              WhatsApp directly.
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCopyMessage}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-[#0B1F3A] transition-colors hover:bg-slate-50"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-[#15803D]" />
                    <span>Message Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Copy Message</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#132C4E]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
