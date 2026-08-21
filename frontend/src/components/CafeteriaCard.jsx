const THEMES = {
  neon: { wrap: 'from-cyan-400 via-fuchsia-500 to-pink-400', bg: 'bg-[#0B041C]', accent: 'text-cyan-300', glow: 'bg-cyan-400/20' },
  gold: { wrap: 'from-amber-300 via-yellow-500 to-orange-400', bg: 'bg-[#1C1408]', accent: 'text-amber-300', glow: 'bg-amber-400/20' },
  emerald: { wrap: 'from-emerald-300 via-teal-500 to-green-400', bg: 'bg-[#04201A]', accent: 'text-emerald-300', glow: 'bg-emerald-400/20' },
  ruby: { wrap: 'from-rose-400 via-pink-500 to-red-400', bg: 'bg-[#1C0510]', accent: 'text-rose-300', glow: 'bg-rose-400/20' },
  ocean: { wrap: 'from-sky-400 via-blue-500 to-cyan-400', bg: 'bg-[#041525]', accent: 'text-sky-300', glow: 'bg-sky-400/20' },
  midnight: { wrap: 'from-slate-300 via-slate-500 to-zinc-400', bg: 'bg-[#020617]', accent: 'text-slate-200', glow: 'bg-slate-400/20' },
};

export const CARD_THEME_LIST = Object.keys(THEMES);

export function maskCafeteriaCard(num) {
  const d = String(num || '').replace(/\D/g, '');
  if (d.length !== 12) return 'xxxx xxxx ----';
  return `xxxx xxxx ${d.slice(-4)}`;
}

export default function CafeteriaCard({
  cardNumber,
  cardMasked,
  cardholder = '',
  balance = 0,
  color = 'neon',
  onClick,
}) {
  const theme = THEMES[color] || THEMES.neon;
  const digits = String(cardNumber || '').replace(/\D/g, '');
  const pan = cardMasked || maskCafeteriaCard(digits);
  const assigned = digits.length === 12 || (cardMasked && !String(cardMasked).includes('----'));

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full text-left overflow-hidden rounded-[22px] p-[1.5px] bg-gradient-to-br ${theme.wrap} shadow-[0_12px_40px_rgba(34,211,238,0.28)] ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`relative rounded-[20.5px] px-5 py-4 min-h-[196px] text-white ${theme.bg}`}>
        <div className={`absolute -right-8 -top-10 h-36 w-36 rounded-full ${theme.glow} blur-2xl`} />
        <div className="relative flex items-start justify-between">
          <div>
            <div className="text-[10px] tracking-[0.22em] font-bold text-violet-200">APPLYWIZZ</div>
            <div className={`text-[11px] tracking-[0.16em] font-bold mt-1 ${theme.accent}`}>
              DIGITAL CAFETERIA CARD
            </div>
          </div>
          <div className="h-8 w-8 rounded-full border-2 border-white/50" />
        </div>
        <div className="relative mt-5 h-7 w-10 rounded-md bg-gradient-to-br from-amber-200 to-amber-500" />
        <div className="relative mt-6 font-mono text-[22px] tracking-[0.28em] font-semibold">
          {pan}
        </div>
        <div className="relative mt-5 flex items-end justify-between gap-3">
          <div>
            <div className="text-[9px] tracking-[0.16em] text-slate-400">CARDHOLDER</div>
            <div className="text-sm font-bold uppercase mt-0.5">
              {(cardholder || 'Applywizzian').slice(0, 22)}
            </div>
          </div>
          <div>
            <div className="text-[9px] tracking-[0.16em] text-slate-400">EXPIRY</div>
            <div className="text-sm font-bold mt-0.5">NO EXPIRY</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] tracking-[0.16em] text-slate-400">COINS</div>
            <div className={`text-lg font-bold ${theme.accent}`}>{Number(balance) || 0}</div>
          </div>
        </div>
        {!assigned ? (
          <div className="relative mt-3 text-[11px] text-slate-400">
            Admin will assign your 12-digit card number.
          </div>
        ) : null}
      </div>
    </button>
  );
}
