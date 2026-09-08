import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft_needs_clarification', label: 'Needs Clarification' },
  { key: 'pending_review', label: 'Pending Review' },
  { key: 'auto_approved', label: 'Auto-Approved' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_STYLE = {
  pending_confirmation: 'bg-sky-100 text-sky-800',
  draft_needs_clarification: 'bg-amber-100 text-amber-800',
  pending_review: 'bg-blue-100 text-blue-800',
  auto_approved: 'bg-emerald-100 text-emerald-800',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-rose-100 text-rose-700',
  synced_to_inventory: 'bg-purple-100 text-purple-700',
};

const STATUS_LABEL = {
  pending_confirmation: 'Confirming',
  draft_needs_clarification: 'Needs Clarification',
  pending_review: 'Pending Review',
  auto_approved: 'Auto-Approved',
  approved: 'Approved',
  rejected: 'Rejected',
  synced_to_inventory: 'Synced',
};

function confBarColor(score) {
  if (!score) return 'bg-slate-200';
  if (score >= 0.85) return 'bg-emerald-500';
  if (score >= 0.7) return 'bg-amber-400';
  return 'bg-rose-400';
}

// ── PurchaseCard ──────────────────────────────────────────────────────────────

function PurchaseCard({
  p,
  expanded,
  onToggle,
  canApprove,
  canClarify,
  busy,
  clarifyActive,
  clarifyText,
  onClarifyToggle,
  onClarifyChange,
  onClarifySubmit,
  rejectActive,
  rejectReason,
  onRejectToggle,
  onRejectReasonChange,
  onRejectSubmit,
  onApprove,
}) {
  const confPct = Math.round((p.ai_confidence || 0) * 100);

  // Derive which actions are valid for THIS card given the viewer's role + purchase status
  const canApproveThis = canApprove && ['pending_review', 'auto_approved'].includes(p.status);
  const canRejectThis = canApprove && ['pending_review', 'auto_approved'].includes(p.status);
  const canClarifyThis =
    canClarify && ['pending_review', 'draft_needs_clarification'].includes(p.status);
  const hasActions = canApproveThis || canRejectThis || canClarifyThis;

  return (
    <div
      className={`card overflow-hidden transition-all ${
        expanded ? 'ring-2 ring-brand border-brand shadow-md' : 'hover:shadow-sm'
      }`}
    >
      {/* ── Summary row — always visible, click to expand ── */}
      <button className="w-full text-left p-4 sm:p-5" onClick={onToggle}>
        {/* Badges + amount */}
        <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
          <div className="flex flex-wrap gap-1.5">
            {p.category && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
                {p.category}
              </span>
            )}
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                STATUS_STYLE[p.status] || 'bg-slate-100 text-slate-600'
              }`}
            >
              {STATUS_LABEL[p.status] || p.status}
            </span>
            {p.duplicate_risk && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-rose-100 text-rose-700">
                ⚠ Duplicate Risk
              </span>
            )}
          </div>
          <span className="text-xl font-bold text-brand shrink-0">
            {p.amount != null ? `₹${p.amount}` : '—'}
          </span>
        </div>

        {/* Item name + quantity */}
        <div className="font-semibold text-slate-900 mb-1.5">
          {p.item_name || (
            <span className="text-slate-400 font-normal italic">Item not extracted</span>
          )}
          {p.brand_name && (
            <span className="ml-1.5 text-slate-500 font-normal text-sm">({p.brand_name})</span>
          )}
          {p.quantity != null && (
            <span className="ml-2 text-slate-500 font-normal text-sm">
              × {p.quantity}
              {p.unit ? ` ${p.unit}` : ''}
            </span>
          )}
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
          {p.vendor_name && <span>🏪 {p.vendor_name}</span>}
          {p.payment_method && <span>💳 {p.payment_method}</span>}
          {p.purchase_date && <span>📅 {p.purchase_date}</span>}
          {p.sender_name && (
            <span>
              👤 {p.sender_name}
              {p.sender_role ? ` · ${p.sender_role}` : ''}
            </span>
          )}
          <span className="text-slate-400">
            {new Date(p.created_at).toLocaleDateString('en-IN')}
          </span>
        </div>

        {/* AI confidence bar */}
        {confPct > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${confBarColor(p.ai_confidence)}`}
                style={{ width: `${confPct}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-400 font-medium shrink-0">AI {confPct}%</span>
          </div>
        )}
      </button>

      {/* ── Expanded section ── */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 sm:px-5 py-4 space-y-4">
          {/* Proof images — click to open full size */}
          {(p.payment_screenshot_url || p.item_photo_url) && (
            <div className="flex flex-wrap gap-3">
              {[p.payment_screenshot_url, p.item_photo_url].filter(Boolean).map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-24 h-24 rounded-xl overflow-hidden border border-slate-200 hover:ring-2 ring-brand shrink-0"
                >
                  <img
                    src={url}
                    alt={i === 0 ? 'Payment proof' : 'Item photo'}
                    className="w-full h-full object-cover"
                  />
                </a>
              ))}
            </div>
          )}

          {/* Brand */}
          {p.brand_name && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Brand
              </p>
              <p className="text-sm text-slate-700 bg-white border border-slate-100 rounded-xl p-3">
                {p.brand_name}
              </p>
            </div>
          )}

          {/* Original Telegram message */}
          {p.raw_telegram_text && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Telegram message
              </p>
              <p className="text-sm text-slate-700 bg-white border border-slate-100 rounded-xl p-3 italic">
                "{p.raw_telegram_text}"
              </p>
            </div>
          )}

          {/* Clarification thread */}
          {p.clarification_question && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                Clarification requested
              </p>
              <p className="text-sm text-amber-800">{p.clarification_question}</p>
              {p.clarification_answer && (
                <p className="text-sm text-emerald-700 font-medium pt-1 border-t border-amber-200">
                  ✓ Reply: {p.clarification_answer}
                </p>
              )}
            </div>
          )}

          {/* Auto-approval reason */}
          {p.auto_approval_reason && p.status === 'auto_approved' && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-sm text-emerald-700">
              <span className="font-bold">Auto-approved: </span>
              {p.auto_approval_reason}
            </div>
          )}

          {/* Rejection reason */}
          {p.rejection_reason && (
            <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 text-sm text-rose-700">
              <span className="font-bold">Rejected: </span>
              {p.rejection_reason}
            </div>
          )}

          {/* Duplicate detail */}
          {p.duplicate_risk && p.duplicate_reason && (
            <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 text-sm text-rose-700">
              ⚠ {p.duplicate_reason}
            </div>
          )}

          {/* ── Action buttons ── */}
          {hasActions && (
            <div className="pt-1 space-y-3">
              <div className="flex flex-wrap gap-2">
                {canApproveThis && !rejectActive && (
                  <button
                    onClick={onApprove}
                    disabled={busy}
                    className="btn-primary text-sm disabled:opacity-50"
                  >
                    {busy ? '…' : '✓ Approve & Stock'}
                  </button>
                )}
                {canClarifyThis && !clarifyActive && !rejectActive && (
                  <button
                    onClick={onClarifyToggle}
                    disabled={busy}
                    className="btn-secondary text-sm disabled:opacity-50"
                  >
                    💬 Ask Clarification
                  </button>
                )}
                {canRejectThis && !rejectActive && !clarifyActive && (
                  <button
                    onClick={onRejectToggle}
                    disabled={busy}
                    className="btn-secondary text-sm text-rose-600 border-rose-100 hover:bg-rose-50 disabled:opacity-50"
                  >
                    ✗ Reject
                  </button>
                )}
              </div>

              {/* Clarify inline panel */}
              {clarifyActive && (
                <div className="space-y-2 bg-white border border-slate-200 rounded-xl p-3">
                  <p className="text-xs text-slate-500">
                    Question will be sent to the submitter via Telegram.
                  </p>
                  <textarea
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand"
                    rows={3}
                    placeholder="Type your clarification question…"
                    value={clarifyText}
                    onChange={(e) => onClarifyChange(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={onClarifySubmit}
                      disabled={busy || !clarifyText.trim()}
                      className="btn-primary text-sm disabled:opacity-50"
                    >
                      {busy ? 'Sending…' : 'Send Question'}
                    </button>
                    <button onClick={onClarifyToggle} className="btn-secondary text-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Reject inline panel */}
              {rejectActive && (
                <div className="space-y-2 bg-white border border-rose-200 rounded-xl p-3">
                  <input
                    type="text"
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                    placeholder="Reason for rejection (optional)"
                    value={rejectReason}
                    onChange={(e) => onRejectReasonChange(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={onRejectSubmit}
                      disabled={busy}
                      className="btn-secondary text-sm border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {busy ? 'Rejecting…' : 'Confirm Reject'}
                    </button>
                    <button onClick={onRejectToggle} className="btn-secondary text-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ManualPurchases() {
  const { profile } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [clarifyId, setClarifyId] = useState(null);
  const [clarifyText, setClarifyText] = useState('');
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState('');

  const canApprove = ['finance', 'leadership'].includes(profile?.role);
  const canClarify = ['finance', 'leadership', 'facility_manager'].includes(profile?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listManualPurchases(activeTab);
      setPurchases(res.purchases || []);
    } catch (e) {
      // Show a friendlier message when the network call completely fails
      // (e.g. VITE_API_BASE_URL not set, Render is asleep, or no internet)
      const msg =
        e.message === 'Failed to fetch'
          ? 'Could not connect to the server. Please check your internet connection or try again in a moment.'
          : e.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(id) {
    if (!window.confirm('Approve and add this purchase to inventory?')) return;
    setBusyId(id);
    try {
      await api.approveManualPurchase(id);
      await load();
      setExpandedId(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id) {
    setBusyId(id);
    try {
      await api.rejectManualPurchase(id, rejectReason.trim() || 'Rejected by reviewer');
      setRejectId(null);
      setRejectReason('');
      await load();
      setExpandedId(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleClarify(id) {
    if (!clarifyText.trim()) return;
    setBusyId(id);
    try {
      await api.clarifyManualPurchase(id, clarifyText.trim());
      setClarifyId(null);
      setClarifyText('');
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function toggleExpand(id) {
    setExpandedId((prev) => (prev === id ? null : id));
    setClarifyId(null);
    setClarifyText('');
    setRejectId(null);
    setRejectReason('');
  }

  function toggleClarify(id) {
    if (clarifyId === id) {
      setClarifyId(null);
      setClarifyText('');
    } else {
      setClarifyId(id);
      setClarifyText('');
      setRejectId(null);
      setRejectReason('');
    }
  }

  function toggleReject(id) {
    if (rejectId === id) {
      setRejectId(null);
      setRejectReason('');
    } else {
      setRejectId(id);
      setRejectReason('');
      setClarifyId(null);
      setClarifyText('');
    }
  }

  function switchTab(key) {
    setActiveTab(key);
    setExpandedId(null);
    setClarifyId(null);
    setClarifyText('');
    setRejectId(null);
    setRejectReason('');
  }

  const needsAttentionCount = purchases.filter((p) =>
    ['pending_review', 'draft_needs_clarification'].includes(p.status)
  ).length;

  return (
    <div className="space-y-6 pb-20">
      {/* Page header */}
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Manual Purchases</h1>
          <p className="text-sm text-slate-500 mt-1">
            No-invoice purchases submitted via Telegram.
          </p>
        </div>
        {needsAttentionCount > 0 && (
          <span className="bg-amber-100 text-amber-800 px-4 py-2 rounded-xl text-sm font-bold border border-amber-200 shrink-0">
            {needsAttentionCount} need attention
          </span>
        )}
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-brand text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
          <div className="w-6 h-6 border-2 border-slate-200 border-t-brand rounded-full animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
          {error}
        </div>
      ) : purchases.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <div className="text-5xl mb-4">🧾</div>
          <div className="font-medium">No purchases here</div>
          <div className="text-sm mt-1">Purchases submitted via Telegram will appear here.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {purchases.map((p) => (
            <PurchaseCard
              key={p.id}
              p={p}
              expanded={expandedId === p.id}
              onToggle={() => toggleExpand(p.id)}
              canApprove={canApprove}
              canClarify={canClarify}
              busy={busyId === p.id}
              clarifyActive={clarifyId === p.id}
              clarifyText={clarifyId === p.id ? clarifyText : ''}
              onClarifyToggle={() => toggleClarify(p.id)}
              onClarifyChange={setClarifyText}
              onClarifySubmit={() => handleClarify(p.id)}
              rejectActive={rejectId === p.id}
              rejectReason={rejectId === p.id ? rejectReason : ''}
              onRejectToggle={() => toggleReject(p.id)}
              onRejectReasonChange={setRejectReason}
              onRejectSubmit={() => handleReject(p.id)}
              onApprove={() => handleApprove(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
