import { useState } from 'react';

/** Ball colours of the USA Bingo logo: B red, I blue, N yellow, G green, O purple. */
const BALLS = [
  ['B', 'from-red-500 to-red-700 text-white'],
  ['I', 'from-blue-500 to-blue-700 text-white'],
  ['N', 'from-yellow-300 to-amber-500 text-ink-950'],
  ['G', 'from-green-500 to-green-700 text-white'],
  ['O', 'from-purple-500 to-purple-800 text-white'],
];

/**
 * The USA Bingo logo. Uses the artwork at /logo.png when the file is present in
 * webapp/public; otherwise renders the same lockup in CSS: stars-and-stripes "USA", gold
 * "BINGO", and the five lettered balls.
 */
export default function Logo({ size = 'md', className = '' }) {
  const [artwork, setArtwork] = useState(true);
  const scale = { sm: 'scale-[0.55]', md: 'scale-90', lg: 'scale-100' }[size] ?? 'scale-90';
  const box = { sm: 'h-16', md: 'h-28', lg: 'h-52' }[size] ?? 'h-28';

  if (artwork) {
    return (
      <img
        src="/logo.png"
        alt="USA Bingo"
        onError={() => setArtwork(false)}
        className={`mx-auto ${box} w-auto object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)] ${className}`}
        draggable="false"
      />
    );
  }

  return (
    <div className={`mx-auto flex ${box} items-center justify-center overflow-visible ${className}`} role="img" aria-label="USA Bingo">
      <div className={`flex flex-col items-center leading-none ${scale} origin-center`}>
        <span
          className="text-5xl font-black tracking-[0.08em] text-transparent bg-clip-text drop-shadow-[0_3px_0_rgba(3,11,42,0.9)]"
          style={{ backgroundImage: 'repeating-linear-gradient(180deg, #ffffff 0 22%, #e11d2e 22% 44%, #ffffff 44% 66%, #e11d2e 66% 88%, #1d4fd8 88% 100%)' }}
        >
          USA
        </span>
        <span className="-mt-1 text-4xl font-black tracking-[0.18em] text-[#ffd200] [text-shadow:0_3px_0_#0b1f5c,0_0_12px_rgba(0,0,0,0.5)]">BINGO</span>
        <span className="mt-2 flex gap-1">
          {BALLS.map(([letter, look]) => (
            <span key={letter} className={`flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-white bg-gradient-to-br ${look} text-sm font-black shadow-[0_3px_6px_rgba(0,0,0,0.45)]`}>
              {letter}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
