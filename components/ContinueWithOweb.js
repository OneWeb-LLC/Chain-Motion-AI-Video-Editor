'use client';

import { owebLoginUrl } from '@/lib/ff/constants';

export default function ContinueWithOweb({ label = 'Continue with OWeb', className = '' }) {
  const href = owebLoginUrl({ launch: true });

  return (
    <a
      href={href}
      className={`inline-flex w-full items-center justify-center rounded-lg border border-[#d9ff00]/30 bg-[#d9ff00]/10 px-5 py-2.5 text-sm font-semibold text-[#d9ff00] no-underline transition hover:bg-[#d9ff00]/20 ${className}`}
    >
      {label}
    </a>
  );
}
