import { useEffect, useState } from 'react';
import { QUOTES, quoteIndexFor } from '@/lib/quotes';

/** A new quote every 30 minutes, tied to the clock so it stays the same across pages and reloads. */
const SLOT_MS = 30 * 60_000;

const slotNow = () => Math.floor(Date.now() / SLOT_MS);

/**
 * "Dear {name}, <quote>". Each person starts at a different place in the list; tap for the next one.
 * Words float in when the quote changes; a soft quote mark drifts. Static with reduced motion.
 */
export function MotivationQuote({ name, seed }: { name: string; seed: string }) {
  const base = quoteIndexFor(seed);
  const [slot, setSlot] = useState(slotNow);
  const [extra, setExtra] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setSlot(slotNow()), SLOT_MS - (Date.now() % SLOT_MS) + 500);
    return () => clearTimeout(t);
  }, [slot]);

  const index = (base + slot + extra) % QUOTES.length;
  const quote = QUOTES[index]!;
  const words = quote.split(' ');

  return (
    <button
      type="button"
      onClick={() => setExtra((e) => e + 1)}
      aria-label={`Motivation for ${name}: ${quote} Tap for another.`}
      className="group relative mt-2 block w-full cursor-pointer select-none text-left"
    >
      <span aria-hidden className="pointer-events-none absolute -right-1 -top-3 animate-[float_6s_ease-in-out_infinite] font-serif text-[72px] leading-none text-brand/15 sm:text-[88px]">
        ”
      </span>
      <span className="block text-[13px] font-medium text-brand">Dear {name},</span>
      <span key={index} className="mt-0.5 block pr-10 text-[17px] font-medium leading-snug tracking-tight text-foreground/85 sm:text-[19px]" aria-hidden>
        {words.map((w, i) => (
          <span key={i} className="inline-block animate-[word-in_0.55s_cubic-bezier(0.2,0.8,0.2,1)_both] whitespace-pre" style={{ animationDelay: `${i * 55}ms` }}>
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </span>
    </button>
  );
}
