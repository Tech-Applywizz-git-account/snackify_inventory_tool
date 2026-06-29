import { Building2, ChevronDown, ChevronRight, ExternalLink, Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import WakingUp from '../components/WakingUp.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';

const fmt = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n || 0);

const EXPENSE_CATEGORIES = ['rental', 'electricity', 'internet', 'maintenance', 'other'];

const palette = {
  consumables: '#0f766e',
  coffee_materials: '#92400e',
  washroom: '#1d4ed8',
  beverages: '#be185d',
  rental: '#7c3aed',
  electricity: '#d97706',
  internet: '#0891b2',
  maintenance: '#059669',
  other: '#64748b',
};

const CURRENT_MONTH = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

export default function Finance() {
  const { profile } = useAuth();
  const isLeadership = profile?.role === 'leadership';

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    label: '',
    amount: '',
    category: 'rental',
    month: CURRENT_MONTH,
    notes: '',
  });

  // Vendor breakdown
  const [vendorData, setVendorData] = useState(null);
  const [vendorMonth, setVendorMonth] = useState(CURRENT_MONTH);
  const [expandedVendor, setExpandedVendor] = useState(null);
  const [expandedBill, setExpandedBill] = useState(null);

  useEffect(() => {
    api
      .spending()
      .then(setData)
      .catch((e) => setErr(e.message));
    api
      .listMonthlyExpenses()
      .then(setExpenses)
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .vendorSummary(vendorMonth)
      .then(setVendorData)
      .catch(() => {});
  }, [vendorMonth]);

  async function addExpense(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api.addMonthlyExpense(form);
      setExpenses((prev) => [created, ...prev]);
      setForm({ label: '', amount: '', category: 'rental', month: CURRENT_MONTH, notes: '' });
      setShowForm(false);
    } catch (ex) {
      alert(ex.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteExpense(id) {
    if (!confirm('Remove this expense?')) return;
    try {
      await api.deleteMonthlyExpense(id);
      setExpenses((prev) => prev.filter((x) => x.id !== id));
    } catch (ex) {
      alert(ex.message);
    }
  }

  if (err) return <div className="text-rose-600 p-4">{err}</div>;
  if (!data)
    return (
      <>
        <WakingUp loading={!data} />
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-brand rounded-full animate-spin" />
          <span className="text-sm">Loading spending…</span>
        </div>
      </>
    );

  const months = [...new Set(data.rows.map((r) => r.month))].sort();
  const chartData = months.map((m) => {
    const row = { month: m };
    for (const r of data.rows.filter((x) => x.month === m)) {
      row[r.category] = Number(r.total_spent);
    }
    return row;
  });

  const categories = Object.keys(data.by_category);
  const expensesTotal = expenses.reduce((s, x) => s + Number(x.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Spending</h1>
        <p className="text-sm text-slate-500">
          Total restocking spend recorded from facility manager updates.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="card">
          <div className="text-xs uppercase text-slate-500">Grand total</div>
          <div className="text-2xl font-bold text-slate-900">{fmt(data.grand_total)}</div>
        </div>
        {categories.map((c) => (
          <div key={c} className="card">
            <div className="text-xs uppercase text-slate-500 capitalize">
              {c.replace(/_/g, ' ')}
            </div>
            <div className="text-xl font-semibold text-slate-900">{fmt(data.by_category[c])}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="font-semibold">Spending by month &amp; category</h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <span key={c} className="flex items-center gap-1.5 text-xs text-slate-500">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: palette[c] || '#64748b' }}
                />
                {c.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
        {chartData.length === 0 ? (
          <div className="text-slate-400 text-sm text-center py-12">
            No transactions yet — once the facility manager submits daily updates, spending will
            appear here.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                maxBarSize={72}
                margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => {
                    const [y, m] = v.split('-');
                    const mn = [
                      'Jan',
                      'Feb',
                      'Mar',
                      'Apr',
                      'May',
                      'Jun',
                      'Jul',
                      'Aug',
                      'Sep',
                      'Oct',
                      'Nov',
                      'Dec',
                    ];
                    return `${mn[parseInt(m, 10) - 1]} ${y}`;
                  }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`)}
                  width={48}
                />
                <Tooltip
                  formatter={(v, name) => [fmt(v), name.replace(/_/g, ' ')]}
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 20px #0001',
                    fontSize: 12,
                  }}
                  cursor={{ fill: '#f8fafc' }}
                />
                {categories.map((c) => (
                  <Bar
                    key={c}
                    dataKey={c}
                    stackId="a"
                    fill={palette[c] || '#64748b'}
                    radius={
                      categories.indexOf(c) === categories.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]
                    }
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Vendor Breakdown ── */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <Building2 size={18} className="text-brand" /> Vendor Breakdown
            </h2>
            <p className="text-xs text-slate-400">
              Bills grouped by vendor — click to expand details.
            </p>
          </div>
          <input
            type="month"
            value={vendorMonth}
            onChange={(e) => setVendorMonth(e.target.value)}
            className="input text-sm"
          />
        </div>

        {/* Summary row */}
        {vendorData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500 uppercase">Vendors</div>
              <div className="text-xl font-bold text-slate-900">{vendorData.vendor_count}</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500 uppercase">Bills</div>
              <div className="text-xl font-bold text-slate-900">{vendorData.bill_count}</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500 uppercase">Total Spend</div>
              <div className="text-xl font-bold text-slate-900">{fmt(vendorData.month_total)}</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-500 uppercase">Avg / Bill</div>
              <div className="text-xl font-bold text-slate-900">
                {vendorData.bill_count > 0
                  ? fmt(vendorData.month_total / vendorData.bill_count)
                  : '—'}
              </div>
            </div>
          </div>
        )}

        {/* Vendor accordions */}
        {!vendorData ? (
          <div className="text-slate-400 text-sm text-center py-8">Loading vendor data…</div>
        ) : vendorData.vendors.length === 0 ? (
          <div className="text-slate-400 text-sm text-center py-8">
            No bills found for this month.
          </div>
        ) : (
          <div className="space-y-3">
            {vendorData.vendors.map((vendor) => {
              const isOpen = expandedVendor === vendor.vendor_name;
              return (
                <div
                  key={vendor.vendor_name}
                  className="border border-slate-200 rounded-xl overflow-hidden"
                >
                  {/* Vendor header */}
                  <button
                    onClick={() => setExpandedVendor(isOpen ? null : vendor.vendor_name)}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 bg-brand/10 text-brand rounded-xl flex items-center justify-center shrink-0">
                        <Building2 size={18} />
                      </div>
                      <div className="text-left min-w-0">
                        <div className="font-semibold text-slate-900 text-sm truncate">
                          {vendor.vendor_name}
                        </div>
                        <div className="text-xs text-slate-400">
                          {vendor.bill_count} bill{vendor.bill_count > 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-bold text-slate-900">{fmt(vendor.total_spend)}</span>
                      {isOpen ? (
                        <ChevronDown size={16} className="text-slate-400" />
                      ) : (
                        <ChevronRight size={16} className="text-slate-400" />
                      )}
                    </div>
                  </button>

                  {/* Expanded bills */}
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/50 divide-y divide-slate-100">
                      {vendor.bills.map((bill) => {
                        const billOpen = expandedBill === bill.id;
                        return (
                          <div key={bill.id} className="px-4 py-3">
                            {/* Bill row */}
                            <button
                              onClick={() => setExpandedBill(billOpen ? null : bill.id)}
                              className="w-full flex items-center justify-between text-left"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Receipt size={14} className="text-slate-400 shrink-0" />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-slate-800 truncate">
                                    Invoice {bill.invoice_number || '—'}
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    {bill.bill_date ||
                                      new Date(bill.created_at).toLocaleDateString('en-IN')}
                                    {' · '}
                                    <span
                                      className={
                                        bill.verification_status === 'Admin Verified'
                                          ? 'text-emerald-600'
                                          : 'text-amber-600'
                                      }
                                    >
                                      {bill.verification_status}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-semibold text-sm text-slate-900">
                                  {fmt(bill.grand_total)}
                                </span>
                                {billOpen ? (
                                  <ChevronDown size={14} className="text-slate-400" />
                                ) : (
                                  <ChevronRight size={14} className="text-slate-400" />
                                )}
                              </div>
                            </button>

                            {/* Bill items */}
                            {billOpen && (
                              <div className="mt-3 ml-6 space-y-1.5">
                                {(bill.items || []).map((item, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs"
                                  >
                                    <span className="text-slate-600">{item.item_name}</span>
                                    <span className="text-slate-500 tabular-nums">
                                      {item.quantity} × {fmt(item.unit_rate || 0)} ={' '}
                                      <strong className="text-slate-800">
                                        {fmt(item.total_amount)}
                                      </strong>
                                    </span>
                                  </div>
                                ))}
                                {bill.file_url && (
                                  <a
                                    href={bill.file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-brand font-semibold mt-2 hover:underline"
                                  >
                                    <ExternalLink size={12} /> View Bill
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Monthly Fixed Expenses */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold">Monthly Fixed Expenses</h2>
            <p className="text-xs text-slate-400">
              Rent, electricity, internet, and other recurring costs.
            </p>
          </div>
          {isLeadership && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="btn-secondary text-sm whitespace-nowrap"
            >
              {showForm ? 'Cancel' : '+ Add Expense'}
            </button>
          )}
        </div>

        {showForm && (
          <form
            onSubmit={addExpense}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 p-4 bg-slate-50 rounded-xl border border-slate-200"
          >
            <div>
              <label className="block text-xs text-slate-500 mb-1">Label</label>
              <input
                className="input w-full"
                placeholder="e.g. Office Rent May"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Amount (₹)</label>
              <input
                className="input w-full"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 45000"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Category</label>
              <select
                className="input w-full"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Month</label>
              <input
                className="input w-full"
                type="month"
                value={form.month}
                onChange={(e) => setForm({ ...form, month: e.target.value })}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Notes (optional)</label>
              <input
                className="input w-full"
                placeholder="e.g. Paid by HDFC transfer"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="btn-primary w-full" disabled={saving}>
                {saving ? 'Saving...' : 'Add Expense'}
              </button>
            </div>
          </form>
        )}

        {expenses.length === 0 ? (
          <div className="text-slate-400 text-sm text-center py-8">
            No fixed expenses recorded yet.
            {isLeadership ? ' Click "+ Add Expense" to log rent or other monthly charges.' : ''}
          </div>
        ) : (
          <div className="space-y-2">
            {expenses.map((exp) => (
              <div
                key={exp.id}
                className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm text-slate-800 truncate">{exp.label}</div>
                  <div className="text-xs text-slate-400 capitalize">
                    {exp.month} · {exp.category}
                    {exp.notes && ` · ${exp.notes}`}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: palette[exp.category] || '#64748b' }}
                  >
                    {fmt(exp.amount)}
                  </span>
                  {isLeadership && (
                    <button
                      onClick={() => deleteExpense(exp.id)}
                      className="text-slate-300 hover:text-rose-500 text-xl leading-none transition-colors"
                      title="Remove"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="flex justify-between items-center pt-3 border-t border-slate-200 font-semibold text-sm">
              <span className="text-slate-700">Total Fixed Expenses</span>
              <span className="text-slate-900">{fmt(expensesTotal)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
