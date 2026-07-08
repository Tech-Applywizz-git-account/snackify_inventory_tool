import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle,
  ChevronRight,
  Minus,
  Plus,
  Timer,
  Trash2,
  X,
  Zap,
  ArrowRight,
  LogOut,
  Coffee,
  ShoppingBag,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';

const LOCATIONS = [
  'Balaji Cabin',
  'RK Cabin',
  'Manisha Cabin',
  'Resume Cabin',
  'Tech Team',
  'Marketing Team',
  'Conference Room',
];

const CATEGORY_EMOJI = {
  beverage: '☕',
  refreshment: '💧',
  food: '🥪',
  snack: '🍪',
  meal: '🍱',
  other: '📦',
};

const CUSTOMER_CATALOG_CATEGORIES = new Set(['food', 'snack', 'meal', 'beverage', 'refreshment']);
const INTERNAL_ONLY_CATEGORY_NAMES = new Set(['accessory', 'accessories', 'rental', 'rentals', 'asset', 'assets']);
const INTERNAL_ONLY_TEXT_PATTERNS = ['rental', 'charger', 'accessor', 'asset', 'internal', 'admin-only'];

function getItemDisplayName(item) {
  const name = item?.item_name || '';
  if (name.toLowerCase().includes('peanut butter')) return 'Peanut Butter Sandwich';
  if (name.toLowerCase().includes('pineapple') && name.toLowerCase().includes('jam')) return 'Pineapple Jam Sandwich';
  if (name.toLowerCase().includes('jam') && (name.toLowerCase().includes('mix') || name.toLowerCase().includes('fruit'))) return 'Mix Fruit Jam Sandwich';
  return item?.frontend_name || item?.display_name || name;
}

function getCatalogSearchText(item) {
  return [
    item?.item_name,
    item?.display_name,
    item?.frontend_name,
    item?.description,
    ...(Array.isArray(item?.tags) ? item.tags : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isCustomerWaterItem(item) {
  const text = (item?.item_name || '').toLowerCase();
  return text === 'water' || text === 'water bottle';
}

function isInternalOnlyCatalogItem(item) {
  const category = String(item?.category || '').toLowerCase();
  const text = getCatalogSearchText(item);
  return (
    INTERNAL_ONLY_CATEGORY_NAMES.has(category) ||
    INTERNAL_ONLY_TEXT_PATTERNS.some((pattern) => text.includes(pattern))
  );
}

function isCustomerCatalogItem(item) {
  if (!item) return false;
  if (isInternalOnlyCatalogItem(item)) return false;
  if (item._missing_stock || item._needs_milk || item._virtual) return true;

  const category = String(item.category || '').toLowerCase();
  if (!CUSTOMER_CATALOG_CATEGORIES.has(category) && !isCustomerWaterItem(item)) return false;

  return item.orderable !== false;
}

// Customization configs
const BREAD_ITEMS = ['bread + peanut butter', 'bread + jam'];
const isBreadItem = (name) => BREAD_ITEMS.includes((name || '').toLowerCase());

const COFFEE_TASTES = ['Light Coffee', 'Less Sugar', 'No Sugar'];
const TEA_TASTES = ['Strong Tea', 'Light Tea', 'Less Sugar', 'No Sugar'];
const LEMON_TASTES = ['Normal', 'Less Sugar', 'Strong Lemon', 'Mild Lemon', 'With Honey 🍯', 'Without Honey'];
const GREEN_TEA_TASTES = ['Plain Green Tea', 'With Honey 🍯', 'With Lemon', 'Light Brew', 'Strong Brew'];
const HOT_CHOC_TASTES = ['Less Sugar', 'No Sugar', 'Extra Milk'];
const WATER_TASTES = ['Cold 🧊', 'Normal 💧', 'Hot ♨️'];

function getTastesForItem(itemName) {
  const n = (itemName || '').toLowerCase();
  if (n.includes('water')) return WATER_TASTES;
  if (n.includes('lemon')) return LEMON_TASTES;
  if (n.includes('green tea')) return GREEN_TEA_TASTES;
  if (n.includes('tea') || n.includes('elaichi') || n.includes('ginger') || n.includes('assam'))
    return TEA_TASTES;
  if (n.includes('hot chocolate') || n.includes('hot choc')) return HOT_CHOC_TASTES;
  if (
    n.includes('coffee') ||
    n.includes('espresso') ||
    n.includes('latte') ||
    n.includes('cappuccino') ||
    n.includes('badam')
  )
    return COFFEE_TASTES;
  return null;
}

export default function Guest() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Menu states
  const [items, setItems] = useState([]);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [cart, setCart] = useState({});
  const [customizations, setCustomizations] = useState({});
  const [deliveryMode, setDeliveryMode] = useState('self_pickup'); // default to pickup
  const [showOrderSheet, setShowOrderSheet] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [selfPickupDay, setSelfPickupDay] = useState(null);

  // Customization targets
  const [beverageTarget, setBeverageTarget] = useState(null);
  const [breadTarget, setBreadTarget] = useState(null);

  // Check existing session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) {
        setSession(data.session);
        loadMenu();
      }
      setLoadingSession(false);
    }).catch(() => setLoadingSession(false));
  }, []);

  const loadMenu = useCallback(async () => {
    setLoadingMenu(true);
    try {
      const [itemsData, pickupStatus] = await Promise.all([
        api.cafeteriaItems(),
        api.selfPickupStatus().catch(() => ({ is_self_pickup_day: false })),
      ]);
      setItems(enrichItemsWithVirtualDrinks(itemsData || []));
      setSelfPickupDay(pickupStatus);
    } catch (e) {
      console.error(e);
      setErrorMsg('Failed to load cafeteria items.');
    } finally {
      setLoadingMenu(false);
    }
  }, []);

  function enrichItemsWithVirtualDrinks(rawItems) {
    if (!rawItems) return [];
    const coffeeBeansRow = rawItems.find((i) => (i.item_name || '').toLowerCase().includes('coffee beans'));
    const lemonSachetsRow = rawItems.find((i) => (i.item_name || '').toLowerCase().includes('lemon sachet'));
    const milkRow = rawItems.find((i) => {
      const n = (i.item_name || '').toLowerCase();
      return n === 'milk' || n.includes('toned milk') || n.includes('milk tetra');
    });
    const waterRow = rawItems.find((i) => {
      const n = (i.item_name || '').toLowerCase();
      return n === 'water' || n.includes('mineral water');
    });

    const milkAvail = milkRow ? (milkRow.stock_servings ?? null) : null;
    const milkInStock = milkRow ? milkAvail === null || milkAvail > 0 : false;
    const waterAvail = waterRow ? (waterRow.stock_servings ?? waterRow.stock_today ?? null) : null;
    const waterInStock = waterRow ? waterAvail === null || waterAvail > 0 : true;

    const hiddenNames = new Set();
    if (coffeeBeansRow) hiddenNames.add(coffeeBeansRow.item_name.toLowerCase());
    if (lemonSachetsRow) hiddenNames.add(lemonSachetsRow.item_name.toLowerCase());

    const filtered = rawItems.map((i) => {
      const nameL = (i.item_name || '').toLowerCase();
      const selfInStock = i.stock_servings === null || i.stock_servings === undefined || i.stock_servings > 0;

      if (hiddenNames.has(nameL)) return { ...i, orderable: false };

      if (
        nameL.includes('elaichi') ||
        nameL.includes('ginger') ||
        nameL.includes('assam tea') ||
        nameL.includes('hot chocolate') ||
        nameL.includes('badam')
      ) {
        return { ...i, orderable: selfInStock && milkInStock && waterInStock, _needs_milk: true };
      }

      const isTeaOrCoffee = nameL.includes('tea') || nameL.includes('coffee') || nameL.includes('cappuccino') || nameL.includes('latte') || nameL.includes('espresso');
      if (isTeaOrCoffee && nameL !== 'lemon tea') {
        return { ...i, orderable: selfInStock && milkInStock && waterInStock };
      }
      return i;
    });

    const virtual = [];
    if (coffeeBeansRow) {
      const cupsAvail = coffeeBeansRow.stock_servings ?? null;
      const coffeeInStock = cupsAvail === null || cupsAvail > 0;

      virtual.push({
        id: coffeeBeansRow.id + '_espresso',
        item_name: 'Espresso',
        display_name: 'Espresso',
        description: 'Intense coffee quickly brewed at high pressure',
        category: 'beverage',
        emoji: '☕',
        stock_servings: cupsAvail,
        stock_today: null,
        orderable: coffeeInStock && waterInStock,
        _virtual: true,
        _backing: coffeeBeansRow.item_name,
        _machine: true,
      });

      virtual.push({
        id: coffeeBeansRow.id + '_americano',
        item_name: 'Americano',
        display_name: 'Americano',
        description: 'Traditional espresso mixed with hot water',
        category: 'beverage',
        emoji: '🫖',
        stock_servings: cupsAvail,
        stock_today: null,
        orderable: coffeeInStock && milkInStock && waterInStock,
        _virtual: true,
        _backing: coffeeBeansRow.item_name,
        _machine: true,
        _needs_milk: true,
      });

      [
        { name: 'Cappuccino', emoji: '☕', id: '_cappuccino', note: 'Equal parts espresso, steamed milk and foamed milk' },
        { name: 'Latte', emoji: '🍵', id: '_latte', note: 'Steamed milk and espresso, topped with milk foam' },
      ].forEach(({ name, emoji, id, note }) => {
        virtual.push({
          id: coffeeBeansRow.id + id,
          item_name: name,
          display_name: name,
          description: note,
          category: 'beverage',
          emoji,
          stock_servings: Math.min(cupsAvail ?? 999, milkAvail ?? 999),
          stock_today: null,
          orderable: coffeeInStock && milkInStock && waterInStock,
          _virtual: true,
          _backing: coffeeBeansRow.item_name,
          _machine: true,
          _needs_milk: true,
        });
      });
    }

    if (lemonSachetsRow) {
      const sachetsAvail = lemonSachetsRow.stock_servings ?? lemonSachetsRow.stock_today ?? null;
      virtual.push({
        id: `${lemonSachetsRow.id}_lemon_tea`,
        item_name: 'Lemon Tea',
        display_name: 'Lemon Tea',
        description: 'Refreshing lemon sachet brew',
        category: 'beverage',
        emoji: '🍋',
        stock_servings: sachetsAvail,
        stock_today: null,
        orderable: (sachetsAvail === null || sachetsAvail > 0) && waterInStock,
        _virtual: true,
        _backing: lemonSachetsRow.item_name,
        _machine: false,
      });
    }

    return [...filtered, ...virtual].filter(isCustomerCatalogItem);
  }

  // Auth Handler
  async function handleLogin(e) {
    e.preventDefault();
    setErrorMsg('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setBusy(true);

    try {
      const data = await api.guestLogin(trimmed, name);
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionErr) throw sessionErr;
      setSession({ user: data.user });
      loadMenu();
    } catch (err) {
      setErrorMsg(err.message || 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  // Logout
  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setCart({});
    setCustomizations({});
  }

  // Cart operations
  function handleAdd(item) {
    const isBev = item.category === 'beverage' && getTastesForItem(item.item_name) !== null;
    const isBread = isBreadItem(item.item_name);

    if (isBev) {
      setBeverageTarget(item);
    } else if (isBread) {
      setBreadTarget(item);
    } else {
      setCart((c) => ({ ...c, [item.id]: (c[item.id] || 0) + 1 }));
    }
  }

  // Update quantity down
  function handleRemove(item) {
    setCart((c) => {
      const val = c[item.id] || 0;
      if (val <= 1) {
        const copy = { ...c };
        delete copy[item.id];
        return copy;
      }
      return { ...c, [item.id]: val - 1 };
    });
  }

  function handleBeverageConfirm({ taste }) {
    if (!beverageTarget) return;
    const id = beverageTarget.id;
    setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
    if (taste) {
      setCustomizations((c) => ({ ...c, [id]: taste }));
    }
    setBeverageTarget(null);
  }

  function handleBreadConfirm({ slices, toast }) {
    if (!breadTarget) return;
    const id = breadTarget.id;
    setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
    setCustomizations((c) => ({ ...c, [id]: `${slices} slice(s), ${toast} toast` }));
    setBreadTarget(null);
  }

  async function handleConfirmOrder({ location, note, cartItems, delivery_mode }) {
    setShowOrderSheet(false);
    setOrderBusy(true);
    setErrorMsg('');
    try {
      const itemsPayload = cartItems.map(({ item, qty, customNote }) => ({
        name: item.item_name,
        qty,
        breadType: '',
        customNote,
      }));

      const r = await api.quickOrder({
        items: itemsPayload,
        location: delivery_mode === 'self_pickup' ? null : location,
        note: note,
        delivery_mode: delivery_mode,
        fulfillmentType: delivery_mode === 'self_pickup' ? 'pickup' : 'delivery',
      });
      const lastReq = r?.request;
      setCart({});
      setCustomizations({});
      setSuccessMsg('Order placed successfully! 🚀');
      setTimeout(() => {
        setSuccessMsg('');
        if (lastReq?.id) navigate(`/guest/track/${lastReq.id}`);
      }, 1500);
    } catch (e) {
      setErrorMsg(e.message || 'Order failed.');
      loadMenu(); // refresh
    } finally {
      setOrderBusy(false);
    }
  }

  // Count helper
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  if (loadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0d1117]">
        <div className="h-10 w-10 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col text-slate-100 font-sans"
      style={{
        background: 'linear-gradient(160deg, #0d1117 0%, #0a0e18 60%, #080c14 100%)',
      }}
    >
      {/* ── Ambient Background Gradients ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-[0.03]"
          style={{ background: 'radial-gradient(circle, #0f766e, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full opacity-[0.03]"
          style={{ background: 'radial-gradient(circle, #10b981, transparent 70%)' }}
        />
      </div>

      <header className="relative z-10 px-4 py-4 flex items-center justify-between border-b border-white/[0.05] bg-white/[0.01] backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2">
          <img src="/logo-icon.png" alt="ApplyWizz" className="h-7 object-contain" />
          <span className="font-extrabold text-sm tracking-wider text-teal-400">GUEST PORTAL</span>
        </div>
        {session && (
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] text-xs font-semibold text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-all"
          >
            <LogOut size={13} /> Sign Out
          </button>
        )}
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto max-w-lg mx-auto w-full px-4 py-6 pb-28">
        <AnimatePresence mode="wait">
          {!session ? (
            /* ═══ STEP 1: Guest Login ═══ */
            <motion.div
              key="login"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ ease: [0.23, 1, 0.32, 1], duration: 0.3 }}
              className="space-y-6 pt-12"
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-teal-500/10 border border-teal-500/20 rounded-3xl mx-auto flex items-center justify-center text-3xl">
                  👋
                </div>
                <h1 className="text-2xl font-black tracking-tight text-white">Welcome, Guest!</h1>
                <p className="text-sm text-slate-400 max-w-xs mx-auto">
                  Enter your email address to directly enter the cafeteria and place an order.
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Guest email
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="guest@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-2xl px-4 py-3.5 text-sm bg-white/[0.03] border border-white/[0.08] text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/50 transition-all font-medium"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Guest name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-2xl px-4 py-3.5 text-sm bg-white/[0.03] border border-white/[0.08] text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/50 transition-all font-medium"
                  />
                </div>

                {errorMsg && (
                  <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                    {errorMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 bg-teal-600 hover:bg-teal-700 active:scale-[0.97] transition-all rounded-2xl text-white font-bold text-sm shadow-lg shadow-teal-700/20 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {busy ? 'Entering…' : 'Enter Cafeteria ⚡'}
                </button>
              </form>
            </motion.div>
          ) : (
            /* ═══ STEP 2: Guest Cafeteria ═══ */
            <motion.div
              key="menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {errorMsg && (
                <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                  {errorMsg}
                </div>
              )}

              {successMsg && (
                <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                  {successMsg}
                </div>
              )}

              <div className="flex items-center justify-between pb-2">
                <div>
                  <h2 className="text-lg font-extrabold text-white">Cafeteria Menu 🍱</h2>
                  <p className="text-xs text-slate-400 font-medium">Browse cafeteria items and select to order</p>
                </div>
                <div className="flex items-center gap-1 bg-teal-500/10 border border-teal-500/20 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold text-teal-400 uppercase tracking-wide">
                  Guest
                </div>
              </div>

              {loadingMenu ? (
                <div className="py-20 flex flex-col items-center justify-center gap-2">
                  <div className="h-6 w-6 border-2 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
                  <span className="text-xs text-slate-400">Loading menu…</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {items.map((item) => {
                    const qty = cart[item.id] || 0;
                    const inCart = qty > 0;
                    const outOfStock =
                      (item.stock_servings !== null && item.stock_servings !== undefined && item.stock_servings <= 0) ||
                      (item.stock_today !== null && item.stock_today !== undefined && item.stock_today <= 0);

                    if (outOfStock) {
                      return (
                        <div
                          key={item.id}
                          className="relative rounded-2xl border border-white/[0.03] bg-white/[0.01] p-3.5 flex items-center gap-3.5 opacity-40 select-none"
                        >
                          <div className="text-3xl grayscale shrink-0">{item.emoji || CATEGORY_EMOJI[item.category] || '☕'}</div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-slate-400 leading-snug">{getItemDisplayName(item)}</div>
                            <div className="text-[10px] text-rose-400 font-extrabold mt-0.5">OUT OF STOCK</div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <motion.div
                        key={item.id}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => !inCart && handleAdd(item)}
                        className={`relative rounded-2xl border p-3.5 flex items-center gap-3.5 transition-all cursor-pointer ${
                          inCart
                            ? 'border-teal-500 bg-teal-500/[0.04]'
                            : 'border-white/[0.05] bg-white/[0.02] hover:border-white/[0.1]'
                        }`}
                      >
                        <div className="text-3xl shrink-0">{item.emoji || CATEGORY_EMOJI[item.category] || '☕'}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-slate-100 leading-snug">{getItemDisplayName(item)}</div>
                          {item.description && (
                            <div className="text-[10px] text-slate-400 truncate mt-0.5 leading-snug">{item.description}</div>
                          )}
                          {item.calories_per_serving && (
                            <div className="text-[9px] text-slate-500 font-normal mt-0.5">{item.calories_per_serving} kcal</div>
                          )}
                        </div>

                        {/* Cart Controller */}
                        <div className="shrink-0">
                          {inCart ? (
                            <div className="flex items-center gap-2 bg-teal-600 rounded-xl p-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemove(item);
                                }}
                                className="h-5 w-5 rounded-lg flex items-center justify-center text-white hover:bg-teal-700 transition-colors"
                              >
                                <Minus size={10} />
                              </button>
                              <span className="font-extrabold text-xs text-white text-center w-3">{qty}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAdd(item);
                                }}
                                className="h-5 w-5 rounded-lg flex items-center justify-center text-white hover:bg-teal-700 transition-colors"
                              >
                                <Plus size={10} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] font-bold text-teal-400 bg-teal-400/10 px-2.5 py-1 rounded-lg">
                              Add +
                            </span>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Bottom Floating Cart Banner (Zomato Style) ── */}
      {session && cartCount > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="fixed bottom-0 left-0 right-0 z-40 bg-[#0d1117]/95 backdrop-blur-md border-t border-white/[0.08] px-4 py-3.5 shadow-2xl flex items-center justify-between max-w-lg mx-auto w-full rounded-t-3xl"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-teal-500/10 border border-teal-500/20 rounded-xl flex items-center justify-center text-teal-400">
              <ShoppingBag size={18} />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wide">
                {cartCount} Item{cartCount > 1 ? 's' : ''} Selected
              </div>
              <div className="text-sm font-bold text-white leading-tight">Ready to check out</div>
            </div>
          </div>

          <button
            onClick={() => setShowOrderSheet(true)}
            className="btn-primary h-11 bg-teal-600 hover:bg-teal-700 rounded-xl px-5 text-sm font-bold shadow-lg shadow-teal-600/20 flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
          >
            Review & Order <ArrowRight size={14} />
          </button>
        </motion.div>
      )}

      {/* ── Customization Sheets ── */}
      <AnimatePresence>
        {/* Beverage Taste Sheet */}
        {beverageTarget && (
          <BeverageSheet
            item={beverageTarget}
            onClose={() => setBeverageTarget(null)}
            onConfirm={handleBeverageConfirm}
          />
        )}

        {/* Bread Customization Sheet */}
        {breadTarget && (
          <BreadSheet
            item={breadTarget}
            onClose={() => setBreadTarget(null)}
            onConfirm={handleBreadConfirm}
          />
        )}

        {/* Checkout / Order Sheet */}
        {showOrderSheet && (
          <CheckoutSheet
            cart={cart}
            customizations={customizations}
            items={items}
            busy={orderBusy}
            deliveryMode={deliveryMode}
            onDeliveryModeChange={setDeliveryMode}
            onUpdateQty={(id, delta) => {
              setCart((c) => {
                const val = c[id] || 0;
                const nextVal = val + delta;
                if (nextVal <= 0) {
                  const copy = { ...c };
                  delete copy[id];
                  return copy;
                }
                return { ...c, [id]: nextVal };
              });
            }}
            onRemoveItem={(id) => {
              setCart((c) => {
                const copy = { ...c };
                delete copy[id];
                return copy;
              });
            }}
            onClose={() => setShowOrderSheet(false)}
            onConfirm={handleConfirmOrder}
            selfPickupDay={selfPickupDay}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Beverage Customization Sheet Component ──
function BeverageSheet({ item, onClose, onConfirm }) {
  const tastes = getTastesForItem(item.item_name) || [];
  const [selected, setSelected] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full sm:max-w-sm bg-[#161b22] border-t border-white/[0.08] sm:border border-white/[0.08] rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-3xl mb-1">{item.emoji || '☕'}</div>
            <h2 className="font-extrabold text-white text-base">{getItemDisplayName(item)}</h2>
            <p className="text-xs text-slate-400">Choose your taste preference</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-white/[0.05] flex items-center justify-center text-slate-400 hover:bg-white/[0.1] active:scale-95 transition-all"
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-6">
          {tastes.map((t) => (
            <button
              key={t}
              onClick={() => setSelected(t)}
              className={`py-3.5 px-2.5 rounded-2xl border-2 text-xs font-bold transition-all active:scale-95 cursor-pointer ${
                selected === t
                  ? 'bg-teal-600 text-white border-teal-600 shadow-md shadow-teal-600/20'
                  : 'border-white/[0.08] bg-white/[0.02] text-slate-300 hover:border-white/[0.15]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <button
          onClick={() => onConfirm({ taste: selected })}
          className="w-full h-12 bg-teal-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-teal-600/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer"
        >
          Add to order ✓
        </button>
      </motion.div>
    </motion.div>
  );
}

// ── Bread Customization Sheet Component ──
function BreadSheet({ item, onClose, onConfirm }) {
  const [slices, setSlices] = useState(1);
  const [toast, setToast] = useState('No Toast');
  const TOAST_OPTS = ['No Toast', 'Light', 'Medium', 'Well Done'];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full sm:max-w-sm bg-[#161b22] border-t border-white/[0.08] sm:border border-white/[0.08] rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-3xl mb-1">{item.emoji || '🥪'}</div>
            <h2 className="font-extrabold text-white text-base">{getItemDisplayName(item)}</h2>
            <p className="text-xs text-slate-400">Bread options</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-white/[0.05] flex items-center justify-center text-slate-400 hover:bg-white/[0.1] active:scale-95 transition-all"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Slices
            </label>
            <div className="flex gap-2">
              {[1, 2].map((n) => (
                <button
                  key={n}
                  onClick={() => setSlices(n)}
                  className={`flex-1 py-3 rounded-2xl border-2 font-bold text-xs transition-all active:scale-95 cursor-pointer ${
                    slices === n
                      ? 'bg-teal-600 text-white border-teal-600 shadow-md'
                      : 'border-white/[0.08] bg-white/[0.02] text-slate-300 hover:border-white/[0.15]'
                  }`}
                >
                  {n} Slice{n > 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Toast Level
            </label>
            <div className="grid grid-cols-2 gap-2">
              {TOAST_OPTS.map((t) => (
                <button
                  key={t}
                  onClick={() => setToast(t)}
                  className={`py-3 rounded-2xl border-2 font-bold text-xs transition-all active:scale-95 cursor-pointer ${
                    toast === t
                      ? 'bg-teal-600 text-white border-teal-600 shadow-md'
                      : 'border-white/[0.08] bg-white/[0.02] text-slate-300 hover:border-white/[0.15]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={() => onConfirm({ slices, toast })}
          className="w-full h-12 bg-teal-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-teal-600/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer"
        >
          Add to order ✓
        </button>
      </motion.div>
    </motion.div>
  );
}

// ── Checkout Sheet Component ──
function CheckoutSheet({
  cart,
  customizations,
  items,
  busy,
  deliveryMode,
  onDeliveryModeChange,
  onUpdateQty,
  onRemoveItem,
  onClose,
  onConfirm,
  selfPickupDay,
}) {
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');

  const cartItems = Object.entries(cart)
    .map(([id, qty]) => ({
      item: items.find((i) => i.id === id),
      qty,
      customNote: customizations[id] || '',
    }))
    .filter((x) => x.item);

  const totalCount = cartItems.reduce((sum, x) => sum + x.qty, 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full sm:max-w-md bg-[#161b22] border-t border-white/[0.08] sm:border border-white/[0.08] rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-extrabold text-white text-base">Review Order 🛒</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-white/[0.05] flex items-center justify-center text-slate-400 hover:bg-white/[0.1] active:scale-95 transition-all"
          >
            <X size={15} />
          </button>
        </div>

        {/* Cart Items List */}
        <div className="space-y-2 mb-5 max-h-[200px] overflow-y-auto">
          {cartItems.map(({ item, qty, customNote }) => (
            <div key={item.id} className="flex items-center justify-between py-2.5 border-b border-white/[0.05] gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xl shrink-0">{item.emoji || '☕'}</span>
                <div className="min-w-0">
                  <div className="font-bold text-xs text-white leading-tight">{getItemDisplayName(item)}</div>
                  {customNote && (
                    <div className="text-[10px] text-slate-500 mt-0.5 italic">{customNote}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onUpdateQty(item.id, -1)}
                  className="h-6 w-6 rounded-lg bg-white/[0.05] flex items-center justify-center text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 active:scale-90 transition-all"
                >
                  <Minus size={10} />
                </button>
                <span className="font-extrabold text-xs text-teal-400 w-3 text-center">{qty}</span>
                <button
                  onClick={() => onUpdateQty(item.id, 1)}
                  className="h-6 w-6 rounded-lg bg-white/[0.05] flex items-center justify-center text-slate-400 hover:bg-teal-500/10 hover:text-teal-400 active:scale-90 transition-all"
                >
                  <Plus size={10} />
                </button>
                <button
                  onClick={() => onRemoveItem(item.id)}
                  className="h-6 w-6 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 hover:bg-rose-500/20 active:scale-90 transition-all ml-1"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Fulfillment Mode */}
        <div className="mb-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
            Fulfillment Mode
          </label>
          {selfPickupDay?.is_self_pickup_day ? (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <span className="text-base">🏃</span>
              <span className="text-xs font-bold text-amber-400">
                Self-pickup only — {selfPickupDay.message}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onDeliveryModeChange('get_it_here')}
                className={`py-3 px-2 rounded-2xl border-2 text-xs font-bold flex flex-col items-center gap-0.5 transition-all active:scale-95 cursor-pointer ${
                  deliveryMode === 'get_it_here'
                    ? 'bg-teal-600 text-white border-teal-600 shadow-md shadow-teal-600/20'
                    : 'border-white/[0.08] bg-white/[0.02] text-slate-300 hover:border-white/[0.15]'
                }`}
              >
                <span>🛵 Deliver to Cabin</span>
                <span className="text-[9px] font-normal opacity-60">Office boy delivers</span>
              </button>
              <button
                type="button"
                onClick={() => onDeliveryModeChange('self_pickup')}
                className={`py-3 px-2 rounded-2xl border-2 text-xs font-bold flex flex-col items-center gap-0.5 transition-all active:scale-95 cursor-pointer ${
                  deliveryMode === 'self_pickup'
                    ? 'bg-teal-600 text-white border-teal-600 shadow-md shadow-teal-600/20'
                    : 'border-white/[0.08] bg-white/[0.02] text-slate-300 hover:border-white/[0.15]'
                }`}
              >
                <span>🏃 Pick up from Cafeteria</span>
                <span className="text-[9px] font-normal opacity-60">Collect from counter</span>
              </button>
            </div>
          )}
        </div>

        {/* Location (if delivery) */}
        {(!selfPickupDay?.is_self_pickup_day && deliveryMode === 'get_it_here') && (
          <div className="mb-4">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Cabin Delivery Location <span className="text-rose-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5 max-h-[140px] overflow-y-auto p-0.5">
              {LOCATIONS.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLocation(loc)}
                  className={`py-2 px-1.5 rounded-xl border text-[11px] font-bold transition-all active:scale-[0.98] cursor-pointer ${
                    location === loc
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'border-white/[0.05] bg-white/[0.01] text-slate-300 hover:border-white/[0.1]'
                  }`}
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Special notes */}
        <div className="mb-5">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
            Special instructions (optional)
          </label>
          <input
            className="w-full bg-white/[0.02] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-xs text-white focus:border-teal-500/50 focus:outline-none"
            placeholder="Extra sugar, cold milk, carry bag, etc."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <button
          disabled={((!selfPickupDay?.is_self_pickup_day && deliveryMode === 'get_it_here') && !location) || busy || totalCount === 0}
          onClick={() =>
            onConfirm({
              location: selfPickupDay?.is_self_pickup_day || deliveryMode === 'self_pickup' ? 'Pantry Counter' : location,
              note,
              cartItems,
              delivery_mode: selfPickupDay?.is_self_pickup_day ? 'self_pickup' : deliveryMode,
            })
          }
          className="w-full h-12 bg-teal-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-teal-600/20 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
        >
          {busy ? (
            <>
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Placing...
            </>
          ) : (
            <>
              <Zap size={14} /> Place Guest Order 🚀
            </>
          )}
        </button>
      </motion.div>
    </motion.div>
  );
}
