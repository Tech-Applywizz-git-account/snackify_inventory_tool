export default function SnackCoin({ size = 16, className = '' }) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center rounded-full shrink-0 text-white font-extrabold ${className}`}
      style={{
        width: size,
        height: size,
        background: '#F5C518',
        border: `${Math.max(1, size * 0.06)}px solid #E8B400`,
        fontSize: Math.round(size * 0.62),
        lineHeight: 1,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      $
    </span>
  );
}

export function CoinPrice({ amount, size = 16 }) {
  return (
    <span className="inline-flex items-center gap-1 font-bold text-slate-900">
      <SnackCoin size={size} />
      <span style={{ fontSize: size }}>{Number(amount) || 0}</span>
    </span>
  );
}
