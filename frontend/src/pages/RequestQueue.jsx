import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';

const STATUS_LABEL = {
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
  ready_for_pickup: 'Ready for Pickup',
};

const STATUS_TONE = {
  pending: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  done: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-100 text-slate-600',
  ready_for_pickup: 'bg-teal-100 text-teal-800',
};

function timeAgo(ts) {
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function DeliveryBadge({ mode }) {
  if (!mode || mode === 'get_it_here') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
        🛵 DELIVER
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
      🏃 SELF PICK
    </span>
  );
}

const RECEIPT_WIDTH = '80mm';

function buildReceiptHTML(order) {
  const orderId = order.user_order_number || (order.id || '').slice(0, 8).toUpperCase();
  const item = order.parsed_item || order.raw_text || 'Unknown Item';
  const employee = order.submitter_name || order.parsed_employee_name || 'Employee';
  const location = order.parsed_location || 'Not specified';
  const instruction = order.instruction || '';
  const isSelfPickup = order.delivery_mode === 'self_pickup';
  const qtyMatch = order.raw_text?.match(/^(\d+)x/);
  const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
  const dateStr = new Date(order.created_at || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const noteMatch = instruction.match(/Note:\s*(.+?)\.?$/i);
  const note = noteMatch?.[1] || '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page { size: ${RECEIPT_WIDTH} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    width: ${RECEIPT_WIDTH};
    padding: 4mm 2mm;
    color: #000;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .line { border-top: 1px dashed #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; padding: 1px 0; }
  .big { font-size: 16px; font-weight: bold; }
  .footer { margin-top: 8px; text-align: center; font-size: 14px; font-weight: bold; }
  @media screen { body { display: none; } }
</style>
</head>
<body>
  <div class="center bold" style="font-size:14px;">APPLYWIZZ OFFICE PANTRY</div>
  <div class="line"></div>
  <div class="row"><span>Order</span><span class="bold">#${orderId}</span></div>
  <div class="row"><span>Date</span><span>${dateStr}</span></div>
  <div class="line"></div>
  <div class="row"><span>Employee</span><span class="bold">${employee}</span></div>
  <div class="row"><span>Location</span><span>${isSelfPickup ? 'Pantry Counter' : location}</span></div>
  <div class="row"><span>Mode</span><span>${isSelfPickup ? '🏃 SELF PICK' : '🛵 DELIVER'}</span></div>
  <div class="line"></div>
  <div class="big center" style="padding:4px 0;">${item}${qty > 1 ? ` x${qty}` : ''}</div>
  ${note ? `<div style="padding:2px 0;font-size:11px;">Note: ${note}</div>` : ''}
  <div class="line"></div>
  <div class="footer">${isSelfPickup ? '⏳ PREPARE & KEEP READY' : '🛵 DELIVER ASAP!'}</div>
  <div class="center" style="font-size:9px;margin-top:6px;color:#666;">Powered by ApplyWizz</div>
</body>
</html>`;
}

function _printReceipt(order) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:none;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(buildReceiptHTML(order));
  doc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.warn('Print failed:', e);
    }
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch (_) {}
    }, 2000);
  };

  iframe.contentWindow.onload = triggerPrint;
  // Fallback if onload doesn't fire
  setTimeout(() => {
    if (iframe.parentNode) triggerPrint();
  }, 500);
}

export default function RequestQueue() {
  const { profile } = useAuth();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState({});

  const load = useCallback(async () => {
    setErr('');
    try {
      const data = await api.listRequests(filter === 'all' ? '' : filter);
      setRows(data);
    } catch (e) {
      setErr(e.message);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id, status, liveStatus, _orderData) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await api.setRequestStatus(id, status, liveStatus);
      // Printing is optional and separate — removed auto-print on accept
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  const isStaff = ['office_boy', 'facility_manager', 'leadership'].includes(profile?.role);

  const grouped = useMemo(() => {
    if (!rows) return null;
    return {
      pending: rows.filter((r) => r.status === 'pending'),
      in_progress: rows.filter((r) => r.status === 'in_progress'),
      done: rows.filter((r) => r.status === 'done'),
      cancelled: rows.filter((r) => r.status === 'cancelled'),
    };
  }, [rows]);

  if (err && !rows) return <div className="text-rose-600">{err}</div>;
  if (!rows) return <div className="text-slate-500">Loading queue...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Request queue</h1>
          <p className="text-sm text-slate-500">
            {isStaff ? 'Work the pending requests top-down.' : 'Your requests.'}
          </p>
        </div>
        <div className="flex gap-1 text-sm">
          {['pending', 'in_progress', 'done', 'all'].map((f) => (
            <button
              key={f}
              className={`px-3 py-1.5 rounded-md ${
                filter === f ? 'bg-brand text-white' : 'bg-slate-100 text-slate-700'
              }`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : STATUS_LABEL[f]}
              {grouped && f !== 'all' && (
                <span className="ml-1 opacity-70">{grouped[f].length}</span>
              )}
            </button>
          ))}
          <button className="btn-secondary text-xs px-3 py-1.5" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {err && <div className="text-sm text-rose-700 bg-rose-50 p-3 rounded-md">{err}</div>}

      {rows.length === 0 ? (
        <div className="card text-slate-500">Nothing here. {isStaff && 'Have a sip of chai.'}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((r) => {
            const isSelfPickup = r.delivery_mode === 'self_pickup';
            const displayStatus =
              r.live_status === 'ready_for_pickup' ? 'ready_for_pickup' : r.status;

            return (
              <div key={r.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`pill ${STATUS_TONE[displayStatus] || STATUS_TONE[r.status]}`}>
                      {STATUS_LABEL[displayStatus] || STATUS_LABEL[r.status]}
                    </span>
                    <DeliveryBadge mode={r.delivery_mode} />
                  </div>
                  <span className="text-xs text-slate-400">{timeAgo(r.created_at)}</span>
                </div>

                <div className="text-base font-semibold text-slate-900">
                  {r.parsed_item || 'Request'}
                  {!isSelfPickup && r.parsed_location && (
                    <span className="text-slate-500 font-normal"> · {r.parsed_location}</span>
                  )}
                  {isSelfPickup && (
                    <span className="text-teal-500 font-normal text-sm"> · Pantry Counter</span>
                  )}
                </div>
                <div className="text-sm text-slate-600 mt-1">{r.instruction}</div>
                <div className="text-xs text-slate-400 mt-2">
                  From:{' '}
                  <span className="text-slate-600">
                    {r.submitter_name || r.parsed_employee_name || '—'}
                  </span>
                </div>

                {isStaff && r.status !== 'done' && r.status !== 'cancelled' && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {/* Accept pending */}
                    {r.status === 'pending' && (
                      <button
                        className="btn-primary text-xs px-3 py-1.5"
                        disabled={busy[r.id]}
                        onClick={() => setStatus(r.id, 'in_progress', 'accepted', r)}
                      >
                        Accept
                      </button>
                    )}

                    {/* Preparing */}
                    {r.status === 'in_progress' && r.live_status === 'accepted' && (
                      <button
                        className="btn-primary text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700"
                        disabled={busy[r.id]}
                        onClick={() => setStatus(r.id, 'in_progress', 'preparing')}
                      >
                        Preparing
                      </button>
                    )}

                    {/* On the way (only for delivery orders) OR Mark as Ready (for self-pickup) */}
                    {r.status === 'in_progress' &&
                      r.live_status === 'preparing' &&
                      (isSelfPickup ? (
                        <button
                          className="btn-primary text-xs px-3 py-1.5 bg-teal-600 hover:bg-teal-700"
                          disabled={busy[r.id]}
                          onClick={() => setStatus(r.id, 'in_progress', 'ready_for_pickup')}
                        >
                          ✅ Mark as Ready
                        </button>
                      ) : (
                        <button
                          className="btn-primary text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700"
                          disabled={busy[r.id]}
                          onClick={() => setStatus(r.id, 'in_progress', 'on_the_way')}
                        >
                          On the Way
                        </button>
                      ))}

                    {/* Mark as Collected (self-pickup after ready) */}
                    {r.status === 'in_progress' && r.live_status === 'ready_for_pickup' && (
                      <button
                        className="btn-primary text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700"
                        disabled={busy[r.id]}
                        onClick={() => setStatus(r.id, 'done', 'done')}
                      >
                        ✓ Mark as Collected
                      </button>
                    )}

                    {/* Mark Done (delivery orders) */}
                    {r.status === 'in_progress' &&
                      !isSelfPickup &&
                      r.live_status === 'on_the_way' && (
                        <button
                          className="btn-primary text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700"
                          disabled={busy[r.id]}
                          onClick={() => setStatus(r.id, 'done', 'done')}
                        >
                          Mark Done
                        </button>
                      )}

                    {/* Cancel always available */}
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      disabled={busy[r.id]}
                      onClick={() => setStatus(r.id, 'cancelled', 'cancelled')}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
