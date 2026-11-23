import { useState } from 'react';
import { CarFront } from 'lucide-react';

interface VehicleImageProps {
  src: string;
  alt: string;
  className?: string;
  aspectClassName?: string;
}

export function VehicleImage({
  src,
  alt,
  className = '',
  aspectClassName = 'aspect-[4/3]',
}: VehicleImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 text-[#0B1F3A]/60 ${aspectClassName} ${className}`}
      >
        <CarFront className="h-12 w-12 stroke-[1.5]" aria-hidden="true" />
        <span className="mt-2 px-4 text-center text-xs font-medium text-slate-600">{alt}</span>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden bg-slate-100 ${aspectClassName}`}>
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
        className={`h-full w-full object-cover ${className}`}
      />
    </div>
  );
}
