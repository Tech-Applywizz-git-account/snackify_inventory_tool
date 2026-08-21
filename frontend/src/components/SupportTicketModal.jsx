import { useState } from 'react';
import { api } from '../lib/api.js';

const OPTIONS = [
  { id: 'coins', t: 'Request for coins', s: 'Ask facility manager to add coins to your wallet.' },
  { id: 'card_missing', t: 'Card is not showing', s: 'Ask facility manager to assign your Digital Cafeteria Card.' },
  { id: 'other', t: 'Other', s: 'Write a short message.' },
];

export default function SupportTicketModal({ open, onClose }) {
  const [kind, setKind] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');

  if (!open) return null;

  async function submit() {
    if (!kind) return;
    setBusy(true);
    setErr('');
    try {
      const data = await api.supportTicket({ kind, message });
      setDone(data?.message || 'Ticket sent.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setKind('');
    setMessage('');
    setDone('');
    setErr('');
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={close}>
      <div className="w-full sm:max-w-md bg-white rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-900">Support ticket</h2>
          <button type="button" onClick={close} className="text-slate-400">✕</button>
        </div>
        {done ? (
          <p className="text-sm text-emerald-700 mb-4">{done}</p>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-3">Facility manager gets this email. Dinesh is CC’d.</p>
            <div className="space-y-2">
              {OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setKind(o.id)}
                  className={`w-full text-left rounded-xl border p-3 ${kind === o.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}
                >
                  <div className="font-semibold text-sm">{kind === o.id ? '✓ ' : ''}{o.t}</div>
                  <div className="text-xs text-slate-500">{o.s}</div>
                </button>
              ))}
            </div>
            {(kind === 'other' || kind) ? (
              <textarea
                className="input mt-3 w-full min-h-[80px]"
                placeholder={kind === 'other' ? 'Describe your request' : 'Optional note'}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            ) : null}
            {err ? <p className="text-sm text-rose-600 mt-2">{err}</p> : null}
          </>
        )}
        <button
          type="button"
          disabled={busy || (!done && !kind)}
          onClick={done ? close : submit}
          className="btn-primary w-full mt-4 disabled:opacity-50"
        >
          {done ? 'Close' : busy ? 'Sending…' : 'Send ticket'}
        </button>
      </div>
    </div>
  );
}
