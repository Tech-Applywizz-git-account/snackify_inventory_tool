import { motion } from 'framer-motion';
import {
  Activity,
  ChevronRight,
  Clock,
  DollarSign,
  History,
  Package,
  Star,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '../lib/supabase.js';

export default function AuditLog() {
  const [stats, setStats] = useState({
    totalValue: 0,
    activeEmployees: 70,
    avgServiceTime: '12m',
    totalRequests: 0,
    avgRating: 4.8,
  });
  const [logs, setLogs] = useState([]);
  const [spendingData, setSpendingData] = useState([]);
  const [ratingData, setRatingData] = useState([]);

  const fetchInsights = useCallback(async () => {
    // 1. Calculate Total Pantry Value
    const { data: inv } = await supabase
      .from('inventory')
      .select('current_stock, products(cost_per_unit, category)');
    const total =
      inv?.reduce(
        (acc, item) => acc + item.current_stock * (item.products?.cost_per_unit || 0),
        0
      ) || 0;

    // 2. Mock some visual data for the charts (In real app, aggregate from transactions/requests)
    setSpendingData([
      { name: 'Mon', amount: 4200 },
      { name: 'Tue', amount: 3800 },
      { name: 'Wed', amount: 5100 },
      { name: 'Thu', amount: 4600 },
      { name: 'Fri', amount: 5900 },
    ]);

    setRatingData([
      { score: '5★', count: 45, color: '#10b981' },
      { score: '4★', count: 12, color: '#34d399' },
      { score: '3★', count: 5, color: '#fbbf24' },
      { score: '2★', count: 2, color: '#f87171' },
      { score: '1★', count: 1, color: '#ef4444' },
    ]);

    setStats((prev) => ({ ...prev, totalValue: total }));

    // 3. Fetch Recent Audit Logs
    const { data: audit } = await supabase
      .from('transactions')
      .select('*, products(name)')
      .order('created_at', { ascending: false })
      .limit(10);
    setLogs(audit || []);
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Office Insights</h1>
          <p className="text-slate-500 mt-1 font-medium">
            Real-time operational overview for Leadership only.
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-2xl border border-emerald-100 font-bold text-sm">
          <Activity size={16} />
          Live Metrics
        </div>
      </div>

      {/* 🚀 QUICK STATS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            label: 'Total Pantry Value',
            value: `₹${stats.totalValue.toLocaleString()}`,
            icon: DollarSign,
            color: 'bg-brand',
          },
          { label: 'Total Requests', value: '342', icon: Package, color: 'bg-blue-500' },
          {
            label: 'Avg Service Time',
            value: stats.avgServiceTime,
            icon: Clock,
            color: 'bg-amber-500',
          },
          {
            label: 'Happiness Score',
            value: `${stats.avgRating}/5`,
            icon: Star,
            color: 'bg-rose-500',
          },
        ].map((stat, i) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={stat.label}
            className="card p-6 flex items-center gap-4"
          >
            <div
              className={`w-12 h-12 ${stat.color} rounded-2xl flex items-center justify-center text-white shadow-lg`}
            >
              <stat.icon size={24} />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                {stat.label}
              </div>
              <div className="text-2xl font-black text-slate-900">{stat.value}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 📈 SPENDING CHART */}
        <div className="lg:col-span-2 card p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <TrendingUp className="text-brand" size={20} />
              Daily Consumption Value
            </h2>
            <select className="bg-slate-50 border-none rounded-lg text-xs font-bold px-3 py-2 text-slate-500 outline-none">
              <option>Last 7 Days</option>
              <option>This Month</option>
            </select>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spendingData}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FB1159" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#FB1159" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#94a3b8', fontSize: 12 }}
                  dy={10}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '16px',
                    border: 'none',
                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="#FB1159"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorValue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ⭐ RATING DISTRIBUTION */}
        <div className="card p-8 space-y-6">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Star className="text-amber-400 fill-amber-400" size={20} />
            Service Happiness
          </h2>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ratingData} layout="vertical">
                <XAxis type="number" hide />
                <YAxis
                  dataKey="score"
                  type="category"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#475569', fontWeight: 700 }}
                />
                <Tooltip cursor={{ fill: 'transparent' }} />
                <Bar dataKey="count" radius={[0, 10, 10, 0]} barSize={20}>
                  {ratingData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-center text-xs text-slate-400 font-medium italic">
            "Jagan is currently the top-rated employee!"
          </p>
        </div>
      </div>

      {/* 📜 RECENT ACTIVITY LOGS */}
      <div className="card overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <History className="text-slate-400" size={20} />
            Recent Inventory Transactions
          </h2>
          <button className="text-brand text-sm font-bold flex items-center gap-1 hover:underline">
            View All History <ChevronRight size={16} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Item
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Action
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Qty
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Cost
                </th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-slate-900">{log.products?.name}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                        log.type === 'add'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-rose-50 text-rose-600'
                      }`}
                    >
                      {log.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-600">{log.quantity}</td>
                  <td className="px-6 py-4 font-bold text-slate-900">₹{log.total_cost}</td>
                  <td className="px-6 py-4 text-xs text-slate-400">
                    {new Date(log.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
