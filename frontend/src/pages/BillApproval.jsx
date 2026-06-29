import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Bot,
  CheckCircle,
  CheckSquare,
  Clock,
  FileText,
  Link,
  MinusCircle,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import WakingUp from '../components/WakingUp.jsx';
import { api } from '../lib/api.js';

// ── Conversion status helpers ──────────────────────────────────────────────
const STATUS_CONFIG = {
  master_match: {
    label: 'Master Match',
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    icon: Zap,
  },
  ai_suggestion: {
    label: 'AI Suggestion',
    color: 'bg-sky-100 text-sky-700 border-sky-200',
    icon: Bot,
  },
  pending_review: {
    label: 'Needs Review',
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    icon: Clock,
  },
  manual_linked: {
    label: 'Manually Linked',
    color: 'bg-violet-100 text-violet-700 border-violet-200',
    icon: Link,
  },
  applied: {
    label: 'Applied',
    color: 'bg-slate-100 text-slate-500 border-slate-200',
    icon: CheckSquare,
  },
  no_stock: {
    label: 'No Stock Update',
    color: 'bg-slate-100 text-slate-500 border-slate-200',
    icon: MinusCircle,
  },
};

function ConversionBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending_review;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}
    >
      <Icon size={10} /> {cfg.label}
    </span>
  );
}

function ItemRow({ item }) {
  const [showAI, setShowAI] = useState(false);
  const hasAI = item.ai_suggestion && Object.keys(item.ai_suggestion).length > 0;

  return (
    <div
      className={`p-3 rounded-xl border ${item.conversion_status === 'pending_review' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-100 bg-slate-50'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-sm text-slate-800 truncate">{item.item_name}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {item.quantity} {item.unit}
            {item.unit_rate ? ` × ₹${item.unit_rate}` : ''}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="font-bold text-slate-900 text-sm">₹{item.total_amount}</span>
          <ConversionBadge status={item.conversion_status} />
        </div>
      </div>

      {/* Converted quantity row */}
      {item.converted_quantity != null && item.conversion_status !== 'no_stock' && (
        <div className="mt-2 text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
          <Zap size={10} />→ {item.converted_quantity} servings added to cafeteria
        </div>
      )}

      {/* AI suggestion detail (collapsed by default) */}
      {hasAI && (
        <div className="mt-2">
          <button
            className="text-[10px] text-sky-600 font-bold hover:underline flex items-center gap-1"
            onClick={() => setShowAI((v) => !v)}
          >
            <Bot size={10} /> {showAI ? 'Hide' : 'Show'} AI suggestion
          </button>
          {showAI && (
            <div className="mt-2 text-[11px] bg-sky-50 border border-sky-100 rounded-lg p-2 space-y-1 text-slate-700">
              <div>
                <span className="font-bold">Classification:</span>{' '}
                {item.ai_suggestion.classification}
              </div>
              <div>
                <span className="font-bold">Canonical name:</span>{' '}
                {item.ai_suggestion.suggested_canonical_name}
              </div>
              {item.ai_suggestion.suggested_units_per_purchase_unit != null && (
                <div>
                  <span className="font-bold">Units per purchase:</span>{' '}
                  {item.ai_suggestion.suggested_units_per_purchase_unit}{' '}
                  {item.ai_suggestion.suggested_storage_unit}
                </div>
              )}
              <div>
                <span className="font-bold">Confidence:</span> {item.ai_suggestion.confidence}
              </div>
              <div className="italic text-slate-500">{item.ai_suggestion.reason}</div>
              <div className="text-amber-700 font-bold mt-1">
                ⚠ Pending leadership approval before stock is applied.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BillApproval() {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBill, setSelectedBill] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blockError, setBlockError] = useState(null);

  const loadBills = useCallback(async () => {
    try {
      const data = await api.listBills();
      setBills(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBills();
  }, [loadBills]);

  async function updateBillStatus(billId, vStatus, aStatus) {
    setBusy(true);
    setBlockError(null);
    try {
      await api.updateBillStatus(billId, {
        verification_status: vStatus,
        approval_status: aStatus,
      });
      await loadBills();
      setSelectedBill(null);
    } catch (e) {
      if (e.message?.includes('Unresolved items') || e.message?.includes('409')) {
        setBlockError(
          'Some items still need conversion review before stock can be applied. Resolve them first.'
        );
      } else {
        alert(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  // Check if the selected bill has unresolved stock items (blocks Approve)
  const pendingItems =
    selectedBill?.bill_items?.filter((i) => i.conversion_status === 'pending_review') ?? [];
  const canApprove = pendingItems.length === 0;

  if (loading)
    return (
      <>
        <WakingUp loading={loading} />
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-brand rounded-full animate-spin" />
          <span className="text-sm">Loading bills…</span>
        </div>
      </>
    );

  const pendingCount = bills.filter(
    (b) => b.verification_status === 'Pending Admin Verification'
  ).length;

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Bill Approvals</h1>
          <p className="text-slate-500">Verify extracted data and approve vendor payments.</p>
        </div>
        <div className="bg-amber-100 text-amber-800 px-4 py-2 rounded-xl text-sm font-bold border border-amber-200 shrink-0">
          {pendingCount} Pending
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Bill List */}
        <div className="xl:col-span-1 space-y-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1">Queue</h2>
          <div className="space-y-3">
            {bills.map((bill) => {
              const unresolvedCount =
                bill.bill_items?.filter((i) => i.conversion_status === 'pending_review').length ??
                0;
              return (
                <button
                  key={bill.id}
                  onClick={() => {
                    setSelectedBill(bill);
                    setBlockError(null);
                  }}
                  className={`w-full text-left card p-4 transition-all hover:translate-x-1 ${
                    selectedBill?.id === bill.id
                      ? 'ring-2 ring-brand bg-brand/5 border-brand'
                      : 'hover:border-brand/40'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-bold text-slate-900">
                      {bill.vendor_name || 'Processing...'}
                    </div>
                    <div className="text-sm font-bold text-brand">₹{bill.grand_total}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                    <FileText size={12} /> {bill.invoice_number || 'No Invoice #'}
                    <span>•</span>
                    <span>{new Date(bill.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <div
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${
                        bill.verification_status === 'Admin Verified'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {bill.verification_status}
                    </div>
                    {unresolvedCount > 0 && (
                      <div className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 flex items-center gap-1">
                        <Clock size={9} /> {unresolvedCount} unresolved
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail View */}
        <div className="xl:col-span-2">
          <AnimatePresence mode="wait">
            {selectedBill ? (
              <motion.div
                key={selectedBill.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="card p-0 overflow-hidden sticky top-6"
              >
                {/* Header */}
                <div className="p-4 sm:p-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap justify-between items-start gap-3">
                  <div>
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                      {selectedBill.vendor_name}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Uploaded by {selectedBill.uploaded_by_name}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      className="btn-secondary text-rose-600 border-rose-100 hover:bg-rose-50 text-sm"
                      onClick={() => updateBillStatus(selectedBill.id, 'Rejected', 'Rejected')}
                      disabled={busy}
                    >
                      <XCircle size={16} /> Reject
                    </button>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        className={`btn-primary text-sm ${!canApprove ? 'opacity-50 cursor-not-allowed' : ''}`}
                        onClick={() =>
                          canApprove &&
                          updateBillStatus(
                            selectedBill.id,
                            'Admin Verified',
                            'Pending Accounts Approval'
                          )
                        }
                        disabled={busy || !canApprove}
                        title={
                          !canApprove
                            ? `${pendingItems.length} item(s) need conversion review first`
                            : ''
                        }
                      >
                        <CheckCircle size={16} />
                        {canApprove
                          ? 'Approve & Sync Stock'
                          : `Blocked (${pendingItems.length} unresolved)`}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Block error */}
                {blockError && (
                  <div className="mx-6 mt-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3 rounded-xl flex gap-2 items-start">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    {blockError}
                  </div>
                )}

                {/* Unresolved warning */}
                {pendingItems.length > 0 && (
                  <div className="mx-6 mt-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 rounded-xl flex gap-2 items-start">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    <span>
                      <strong>
                        {pendingItems.length} item{pendingItems.length > 1 ? 's' : ''} need
                        {pendingItems.length === 1 ? 's' : ''} conversion review.
                      </strong>{' '}
                      Link them to a master rule or classify as supply/equipment/expense before
                      approving.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2">
                  {/* Invoice image */}
                  <div className="p-6 bg-slate-900 flex items-center justify-center min-h-[400px]">
                    {selectedBill.file_url?.match(/\.pdf($|\?)/i) ? (
                      <a
                        href={selectedBill.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white/70 hover:text-white text-sm flex flex-col items-center gap-2"
                      >
                        <FileText size={40} />
                        Open PDF
                      </a>
                    ) : (
                      <img
                        src={selectedBill.file_url}
                        className="max-w-full rounded shadow-2xl cursor-zoom-in"
                        alt="Invoice"
                      />
                    )}
                  </div>

                  {/* Extracted data + conversion status */}
                  <div className="p-6 space-y-6 overflow-y-auto max-h-[700px]">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
                        Items & Conversion
                      </h4>
                      <div className="space-y-3">
                        {selectedBill.bill_items?.map((item, idx) => (
                          <ItemRow key={idx} item={item} />
                        ))}
                      </div>
                    </div>

                    {/* Totals */}
                    <div className="pt-6 border-t border-slate-100 space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Subtotal</span>
                        <span className="font-medium">
                          ₹
                          {(
                            Number(selectedBill.grand_total) -
                            Number(selectedBill.delivery_charges) +
                            Number(selectedBill.discount)
                          ).toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Delivery</span>
                        <span className="font-medium text-rose-600">
                          + ₹{selectedBill.delivery_charges}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Discount</span>
                        <span className="font-medium text-emerald-600">
                          - ₹{selectedBill.discount}
                        </span>
                      </div>
                      <div className="flex justify-between text-xl font-bold pt-2 border-t border-slate-100">
                        <span>Grand Total</span>
                        <span className="text-brand">₹{selectedBill.grand_total}</span>
                      </div>
                    </div>

                    {selectedBill.needs_manual_review && (
                      <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-amber-800 italic text-sm">
                        <AlertTriangle size={20} className="shrink-0" />
                        AI Flag:{' '}
                        {selectedBill.manual_review_reason ||
                          'Image clarity is low. Please double check quantities.'}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full min-h-[500px] border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center text-slate-400 space-y-4">
                <ShieldCheck size={64} className="opacity-20" />
                <div className="font-medium">Select a bill from the queue to verify</div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
