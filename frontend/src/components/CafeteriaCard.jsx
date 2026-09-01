import awIcon from '../assets/aw-icon.png';

export function formatCardNumber(raw) {
  const s = String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!s) return '';
  return s.replace(/(.{4})/g, '$1 ').trim();
}

export function maskCafeteriaCard(num) {
  return formatCardNumber(num) || 'XXXX XXXX XXXX XXXX';
}

export default function CafeteriaCard({
  cardNumber,
  cardMasked,
  cardholder = '',
  onClick,
}) {
  const raw = String(cardNumber || cardMasked || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const pan = formatCardNumber(raw) || 'XXXX XXXX XXXX XXXX';
  const assigned = raw.length > 0;
  const holder = String(cardholder || 'Applywizzian').slice(0, 24);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full text-left ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div
        className="relative w-full max-w-[380px] rounded-[28px] p-[25px] overflow-hidden"
        style={{
          background:
  'radial-gradient(circle at 0% 0%, rgba(47,123,255,0.7), transparent 55%), radial-gradient(circle at 100% 100%, rgba(182,240,0,0.7), transparent 55%), linear-gradient(135deg, #0B1B3A 0%, #0B1220 50%, #14240F 100%)',

          boxShadow: '0 5px 10px rgba(0,0,0,0.1)',
        }}
      >
        <header className="flex items-center justify-between gap-3">
          <span className="flex items-center min-w-0">
            <img src={awIcon} alt="" className="h-12 w-12 rounded-[10px] object-cover mr-2.5 shrink-0" />
            <h5 className="text-[13px] leading-4 font-normal text-white">
              Enougher Applywizz PVT LTD
            </h5>
          </span>
        </header>
        <div className="mt-10 flex justify-between items-end gap-3">
          <div className="min-w-0">
            <h6 className="text-[10px] font-normal text-white">Card Number</h6>
            <h5 className="mt-1 text-lg font-normal tracking-wide text-white">{pan}</h5>
            <h5 className="mt-5 text-base font-normal text-white truncate">{holder}</h5>
          </div>
          <div className="text-right shrink-0">
            <h6 className="text-[10px] font-normal text-white">Valid Thru</h6>
            <h5 className="mt-1 text-base font-normal text-white">NO EXPIRY</h5>
          </div>
        </div>
      </div>
      {!assigned ? (
        <div className="mt-3 text-[11px] text-slate-400">Admin will assign your card number.</div>
      ) : null}
    </button>
  );
}
