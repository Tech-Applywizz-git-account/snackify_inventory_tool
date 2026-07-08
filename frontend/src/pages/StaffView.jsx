import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';

const CATEGORY_EMOJI = {
  beverage: '☕',
  food: '🥪',
  snack: '🍪',
  meal: '🍱',
  stationery: '📎',
  cleaning: '🧹',
  other: '📦',
  sanitary: '🧼',
  electronic_gadgets: '🔌',
};

// ── OB Leave Form ─────────────────────────────────────────────────────────────
function OBLeaveSection({ userId: _userId }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [leaveDate, setLeaveDate] = useState(todayStr);
  const [leaveType, setLeaveType] = useState('full_day');
  const [halfSlot, setHalfSlot] = useState('morning');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const [err, setErr] = useState('');
  const [leaves, setLeaves] = useState([]);

  useEffect(() => {
    api
      .listOBLeave()
      .then(setLeaves)
      .catch(() => {});
  }, []);

  async function apply(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setSuccess('');
    try {
      await api.applyOBLeave({
        leave_date: leaveDate,
        leave_type: leaveType,
        half_day_slot: leaveType === 'half_day' ? halfSlot : undefined,
        reason: reason || undefined,
      });
      const slotLabel =
        leaveType === 'full_day'
          ? 'Full Day'
          : `Half Day — ${halfSlot === 'morning' ? 'Morning (9am–1pm)' : 'Afternoon (1pm–5pm)'}`;
      setSuccess(
        `✅ Leave applied for ${new Date(leaveDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} (${slotLabel}). Leadership notified.`
      );
      setReason('');
      api
        .listOBLeave()
        .then(setLeaves)
        .catch(() => {});
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelLeave(id) {
    if (!confirm('Cancel this leave?')) return;
    try {
      await api.cancelOBLeave(id);
      setLeaves((l) => l.filter((x) => x.id !== id));
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-bold text-slate-900 flex items-center gap-2">🏖 Apply Leave</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Cafeteria switches to self-pickup mode automatically for that slot.
        </p>
      </div>

      <form onSubmit={apply} className="space-y-3">
        {/* Date */}
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
            Date
          </label>
          <input
            type="date"
            value={leaveDate}
            min={todayStr}
            onChange={(e) => setLeaveDate(e.target.value)}
            className="w-full border-2 border-slate-100 rounded-xl px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        {/* Duration */}
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
            Duration
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: 'full_day', l: '🌞 Full Day' },
              { v: 'half_day', l: '🌤 Half Day' },
            ].map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setLeaveType(opt.v)}
                className={`py-2 rounded-xl border-2 font-semibold text-sm transition-all ${
                  leaveType === opt.v
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white text-slate-600 border-slate-100 hover:border-brand/30'
                }`}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>

        {/* Half day slot */}
        {leaveType === 'half_day' && (
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Slot
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'morning', l: '🌅 Morning (9am–1pm)' },
                { v: 'afternoon', l: '🌇 Afternoon (1pm–5pm)' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setHalfSlot(opt.v)}
                  className={`py-2 rounded-xl border-2 font-semibold text-xs transition-all ${
                    halfSlot === opt.v
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white text-slate-600 border-slate-100 hover:border-orange-200'
                  }`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reason */}
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">
            Reason (optional)
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Personal work, medical appointment…"
            className="w-full border-2 border-slate-100 rounded-xl px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        {/* Warning */}
        <div className="p-3 bg-orange-50 border border-orange-100 rounded-xl text-xs text-orange-700">
          ⚠️ This will auto-switch cafeteria to <strong>Self-Pickup mode</strong> for that slot.
          Leadership will be notified on Teams.
        </div>

        {err && <div className="text-xs text-rose-600 font-medium">{err}</div>}
        {success && <div className="text-xs text-emerald-700 font-medium">{success}</div>}

        <button
          type="submit"
          disabled={busy}
          className="w-full h-10 bg-brand text-white rounded-xl font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {busy ? (
            <>
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{' '}
              Applying…
            </>
          ) : (
            '🏖 Apply Leave & Notify'
          )}
        </button>
      </form>

      {/* Leave history */}
      {leaves.length > 0 && (
        <div>
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            Recent Leaves
          </div>
          <div className="space-y-2">
            {leaves.slice(0, 5).map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100"
              >
                <div>
                  <div className="text-xs font-semibold text-slate-700">
                    {new Date(l.leave_date).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                    {' — '}
                    {l.leave_type === 'full_day' ? 'Full Day' : `Half Day (${l.half_day_slot})`}
                  </div>
                  {l.reason && <div className="text-[10px] text-slate-400">{l.reason}</div>}
                </div>
                {l.leave_date >= new Date().toISOString().slice(0, 10) && (
                  <button
                    onClick={() => cancelLeave(l.id)}
                    className="text-[10px] text-rose-500 font-bold hover:underline px-2"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StaffView() {
  const { profile } = useAuth();
  const isStaff = ['office_boy', 'facility_manager', 'leadership'].includes(profile?.role);
  const canAdd = ['facility_manager', 'leadership'].includes(profile?.role);

  const [items, setItems] = useState(null);
  const [officeSupplies, setOfficeSupplies] = useState([]);
  const [cafItems, setCafItems] = useState([]);
  const [err, setErr] = useState('');
  const [stockSaving, setStockSaving] = useState({});
  const [activeSection, setActiveSection] = useState('pantry'); // 'pantry' | 'office_supplies'
  const [activeOfficeCat, setActiveOfficeCat] = useState('sanitary');

  // Modal State for adding new entity
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalCategory, setModalCategory] = useState('');
  const [modalSection, setModalSection] = useState(''); // 'pantry' | 'office_supplies'
  const [newItemName, setNewItemName] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('pieces');
  const [newItemCost, setNewItemCost] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    api
      .inventoryStatus()
      .then(setItems)
      .catch((e) => setErr(e.message));

    api
      .listOfficeSupplies()
      .then((data) => {
        if (Array.isArray(data)) setOfficeSupplies(data);
      })
      .catch(() => {});

    if (isStaff) {
      // Load ALL cafeteria items including unavailable ones for stock mgmt
      fetch('/api/cafeteria/items', {
        headers: { Authorization: `Bearer ${window.__supabaseSession?.access_token || ''}` },
      })
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setCafItems(data); })
        .catch(() => {});
      // Use api method (already filters available=true, but that's fine for display)
      api
        .cafeteriaItems()
        .then((data) => { if (Array.isArray(data)) setCafItems(data); })
        .catch(() => {});
    }
  }, [isStaff]);

  // Mark an item as out of stock (stock_today = 0) or restore (stock_today = null)
  async function toggleStock(item) {
    const isOut =
      item.stock_today !== null && item.stock_today !== undefined && item.stock_today <= 0;
    const newStock = isOut ? null : 0;

    setStockSaving((s) => ({ ...s, [item.id]: true }));
    try {
      const updated = await api.updateCafeteriaItem(item.id, { stock_today: newStock });
      setCafItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, stock_today: updated.stock_today } : i))
      );
    } catch (e) {
      alert(`Failed: ${e.message}`);
    } finally {
      setStockSaving((s) => ({ ...s, [item.id]: false }));
    }
  }

  // Reset all items' stock to available
  async function resetAllStock() {
    if (!confirm('Mark all items as available again?')) return;
    const outItems = (Array.isArray(cafItems) ? cafItems : []).filter((i) => i.stock_today !== null && i.stock_today <= 0);
    for (const item of outItems) {
      await api.updateCafeteriaItem(item.id, { stock_today: null }).catch(() => {});
    }
    setCafItems((prev) => prev.map((i) => ({ ...i, stock_today: null })));
  }

  async function handleAddItemSubmit(e) {
    e.preventDefault();
    if (!newItemName.trim()) return;

    setIsSubmitting(true);
    try {
      if (modalSection === 'pantry') {
        const payload = {
          name: newItemName.trim(),
          category: modalCategory,
          unit: newItemUnit,
          cost_per_unit: Number(newItemCost) || 0,
        };
        await api.createProduct(payload);
        const updatedItems = await api.inventoryStatus();
        setItems(updatedItems);
      } else {
        const payload = {
          name: newItemName.trim(),
          category: modalCategory,
          unit: newItemUnit,
          cost_per_unit: Number(newItemCost) || 0,
        };
        await api.createOfficeSupply(payload);
        const updatedSupplies = await api.listOfficeSupplies();
        setOfficeSupplies(updatedSupplies);
      }
      setNewItemName('');
      setNewItemUnit('pieces');
      setNewItemCost('');
      setShowAddModal(false);
    } catch (err) {
      alert(`Failed to add item: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (err) return <div className="text-rose-600">{err}</div>;
  if (!items)
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <div className="w-7 h-7 border-2 border-slate-200 border-t-brand rounded-full animate-spin mr-3" />
        Loading…
      </div>
    );

  // Group pantry items
  const grouped = items.reduce((acc, r) => {
    const k = r.category || 'other';
    acc[k] ??= [];
    acc[k].push(r);
    return acc;
  }, {});

  // Group cafeteria items by category
  const safeCafItems = Array.isArray(cafItems) ? cafItems : [];
  const cafGrouped = safeCafItems.reduce((acc, item) => {
    const cat = item.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});
  const cafCats = ['beverage', 'food', 'snack', 'other'].filter((c) => cafGrouped[c]?.length);

  const outOfStockCount = safeCafItems.filter(
    (i) => i.stock_today !== null && i.stock_today !== undefined && i.stock_today <= 0
  ).length;

  // Categories lists
  const pantryCats = ['consumables', 'coffee_materials', 'beverages', 'washroom', 'other'];
  const officeCats = ['sanitary', 'stationery', 'electronic_gadgets'];

  // Group office supplies
  const officeGrouped = officeSupplies.reduce((acc, r) => {
    const k = r.category || 'stationery';
    acc[k] ??= [];
    acc[k].push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* ── Tabs for Pantry vs Office Supplies ── */}
      <div className="flex justify-start gap-6 border-b border-slate-200">
        <button
          onClick={() => setActiveSection('pantry')}
          className={`pb-3 font-bold text-sm border-b-2 transition-all ${
            activeSection === 'pantry'
              ? 'border-brand text-brand'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          To Pantry Inventory
        </button>
        <button
          onClick={() => setActiveSection('office_supplies')}
          className={`pb-3 font-bold text-sm border-b-2 transition-all ${
            activeSection === 'office_supplies'
              ? 'border-brand text-brand'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          📎 Office Supplies
        </button>
      </div>

      {activeSection === 'pantry' ? (
        <>
          {/* ── OB Leave Section ── */}
          {profile?.role === 'office_boy' && <OBLeaveSection userId={profile.id} />}

          {/* ── Today's Cafeteria Stock (office boy controls) ── */}
          {isStaff && safeCafItems.length > 0 && (
            <div className="card space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold text-slate-900">Today's Cafeteria Stock</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Toggle to mark items as out of stock — employees will see "😔 Out today" and can't
                    order.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {outOfStockCount > 0 && (
                    <span className="text-xs bg-rose-100 text-rose-600 font-bold px-2.5 py-1 rounded-full">
                      {outOfStockCount} out of stock
                    </span>
                  )}
                  {outOfStockCount > 0 && (
                    <button
                      onClick={resetAllStock}
                      className="text-xs text-brand font-bold hover:underline"
                    >
                      Reset all →
                    </button>
                  )}
                </div>
              </div>

              {cafCats.map((cat) => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">{CATEGORY_EMOJI[cat]}</span>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider capitalize">
                      {cat === 'beverage'
                        ? 'Drinks'
                        : cat === 'food'
                          ? 'Food'
                          : cat === 'snack'
                            ? 'Snacks'
                            : cat}
                    </div>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>
                  <div className="space-y-2">
                    {cafGrouped[cat].map((item) => {
                      const isOut =
                        item.stock_today !== null &&
                        item.stock_today !== undefined &&
                        item.stock_today <= 0;
                      const saving = stockSaving[item.id];
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                            isOut ? 'bg-rose-50 border-rose-100' : 'bg-slate-50 border-slate-100'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={isOut ? 'grayscale' : ''}>{item.emoji || '☕'}</span>
                            <div>
                              <div
                                className={`text-sm font-semibold ${isOut ? 'text-slate-400 line-through' : 'text-slate-800'}`}
                              >
                                {item.item_name}
                              </div>
                              {isOut && (
                                <div className="text-xs text-rose-500 font-medium">
                                  Out of stock today
                                </div>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => toggleStock(item)}
                            disabled={saving}
                            className={`relative w-11 rounded-full transition-colors shrink-0 ${
                              isOut ? 'bg-rose-400' : 'bg-emerald-400'
                            }`}
                            style={{ height: 24 }}
                            title={
                              isOut ? 'Click to mark as available' : 'Click to mark as out of stock'
                            }
                          >
                            {saving ? (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                              </div>
                            ) : (
                              <div
                                className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${isOut ? 'left-1' : 'left-6'}`}
                              />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <h1 className="text-2xl font-semibold">What's in the pantry</h1>
            <p className="text-sm text-slate-500">Updated daily by the facility manager.</p>
          </div>
          {pantryCats.map((cat) => {
            const rows = grouped[cat] || [];
            return (
              <div key={cat} className="card">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold capitalize flex items-center gap-2">
                    <span>{CATEGORY_EMOJI[cat] || '📦'}</span>
                    <span>{cat.replace('_', ' ')}</span>
                  </h2>
                  {canAdd && (
                    <button
                      onClick={() => {
                        setModalSection('pantry');
                        setModalCategory(cat);
                        setShowAddModal(true);
                      }}
                      className="text-xs font-bold text-brand hover:underline flex items-center gap-1"
                    >
                      ➕ Add Item
                    </button>
                  )}
                </div>
                {rows.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No items in this category yet.</p>
                ) : (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {rows.map((r) => {
                      const isOut = r.stock_status === 'out_of_stock';
                      const isLow = r.stock_status === 'low';
                      return (
                        <li
                          key={r.product_id}
                          className={`p-3 rounded-lg border flex items-center justify-between ${
                            isOut
                              ? 'border-rose-200 bg-rose-50 text-rose-900'
                              : isLow
                                ? 'border-amber-200 bg-amber-50 text-amber-900'
                                : 'border-slate-200 bg-white'
                          }`}
                        >
                          <span className="font-medium text-sm">{r.product_name}</span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                            {isOut ? 'out' : `${r.current_stock} ${r.unit}`}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-semibold">Office Supplies</h1>
            <p className="text-sm text-slate-500">Tracked office supplies and essentials.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Sidebar Column */}
            <div className="md:col-span-1 space-y-1">
              {officeCats.map((cat) => {
                const isActive = activeOfficeCat === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveOfficeCat(cat)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm text-left transition-all ${
                      isActive
                        ? 'bg-brand/10 text-brand border-l-4 border-brand shadow-sm'
                        : 'bg-white text-slate-600 border border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    <span>{CATEGORY_EMOJI[cat] || '📎'}</span>
                    <span className="capitalize">{cat.replace('_', ' ')}</span>
                  </button>
                );
              })}
            </div>

            {/* Selected Category Content Column */}
            <div className="md:col-span-3">
              {(() => {
                const cat = activeOfficeCat;
                const rows = officeGrouped[cat] || [];
                return (
                  <div className="card space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <h2 className="font-bold text-lg text-slate-800 capitalize flex items-center gap-2">
                        <span>{CATEGORY_EMOJI[cat] || '📎'}</span>
                        <span>{cat.replace('_', ' ')}</span>
                      </h2>
                      {canAdd && (
                        <button
                          onClick={() => {
                            setModalSection('office_supplies');
                            setModalCategory(cat);
                            setShowAddModal(true);
                          }}
                          className="text-xs font-bold text-brand hover:underline flex items-center gap-1"
                        >
                          ➕ Add Item
                        </button>
                      )}
                    </div>
                    {rows.length === 0 ? (
                      <p className="text-sm text-slate-400 italic py-4">No items in this category yet.</p>
                    ) : (
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {rows.map((r) => {
                          const isOut = Number(r.current_stock) <= 0;
                          const isLow = Number(r.current_stock) <= Number(r.min_threshold);
                          return (
                            <li
                              key={r.id}
                              className={`p-3 rounded-lg border flex items-center justify-between ${
                                isOut
                                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                                  : isLow
                                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                                    : 'border-slate-200 bg-white'
                              }`}
                            >
                              <span className="font-medium text-sm">{r.name}</span>
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                                {isOut ? 'out' : `${r.current_stock} ${r.unit}`}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* ── Add Entity Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-lg text-slate-800">
                ➕ Add {modalSection === 'pantry' ? 'Pantry' : 'Office'} Item
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleAddItemSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Item Name
                </label>
                <input
                  type="text"
                  required
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g. A4 Paper, Hand Sanitizer..."
                  className="w-full border-2 border-slate-100 rounded-xl px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                  Category
                </label>
                <input
                  type="text"
                  disabled
                  value={modalCategory.replace('_', ' ')}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-3 py-2 text-sm text-slate-500 capitalize"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    Unit
                  </label>
                  <select
                    value={newItemUnit}
                    onChange={(e) => setNewItemUnit(e.target.value)}
                    className="w-full border-2 border-slate-100 rounded-xl px-3 py-2 text-sm focus:border-brand focus:outline-none bg-white"
                  >
                    <option value="pieces">Pieces</option>
                    <option value="packs">Packs</option>
                    <option value="kg">kg</option>
                    <option value="liters">Liters</option>
                    <option value="boxes">Boxes</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    Cost per Unit (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={newItemCost}
                    onChange={(e) => setNewItemCost(e.target.value)}
                    placeholder="0.00"
                    className="w-full border-2 border-slate-100 rounded-xl px-3 py-2 text-sm focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 h-10 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 h-10 bg-brand text-white rounded-xl font-bold text-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Adding...' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
