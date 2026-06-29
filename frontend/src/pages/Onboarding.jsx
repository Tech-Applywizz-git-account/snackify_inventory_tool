import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { supabase } from '../lib/supabase.js';

/* ── Static data ─────────────────────────────────────────────────── */
// Top-level drink categories
const DRINK_CATEGORIES = [
  {
    id: 'coffee',
    emoji: '☕',
    label: 'CCD Coffee',
    subs: [
      { id: 'Espresso', emoji: '☕', label: 'Espresso' },
      { id: 'Latte', emoji: '☕', label: 'Latte' },
      { id: 'Cappuccino', emoji: '☕', label: 'Cappuccino' },
      { id: 'Hot Chocolate', emoji: '🍫', label: 'Hot Chocolate' },
      { id: 'Badam Mix', emoji: '🥜', label: 'Badam Mix' },
    ],
  },
  {
    id: 'tea',
    emoji: '🍵',
    label: 'Tea',
    subs: [
      { id: 'Assam Tea', emoji: '🍵', label: 'Assam Tea' },
      { id: 'Elaichi Tea', emoji: '🍵', label: 'Elaichi Tea' },
      { id: 'Ginger Tea', emoji: '🍵', label: 'Ginger Tea' },
      { id: 'Green Tea', emoji: '🍃', label: 'Green Tea' },
      { id: 'Lemon Tea', emoji: '🍋', label: 'Lemon Tea' },
    ],
  },
  { id: 'water', emoji: '💧', label: 'Water', subs: [] },
  { id: 'none', emoji: '🚫', label: 'None for me', subs: [] },
];

// Legacy format compat
const _DRINK_OPTS = DRINK_CATEGORIES;

const SNACK_OPTS = [
  { id: 'Bread + Peanut Butter', emoji: '🥜', label: 'Bread + PB' },
  { id: 'Bread + Jam', emoji: '🍓', label: 'Bread + Jam' },
  { id: 'Biscuits', emoji: '🍪', label: 'Biscuits' },
  { id: 'none', emoji: '🚫', label: 'No Snacks' },
];

const COFFEE_TASTE = [
  'Strong Coffee',
  'Light Coffee',
  'Less Sugar',
  'No Sugar',
  'With Milk',
  'Without Milk',
];
const TEA_TASTE = ['Strong Tea', 'Light Tea', 'Less Sugar', 'No Sugar'];
const LEMON_TASTE = [
  'Normal',
  'Less Sugar',
  'Strong Lemon',
  'Mild Lemon',
  'With Honey 🍯',
  'Without Honey',
];
const GREEN_TEA_TASTE = [
  'Plain Green Tea',
  'With Honey 🍯',
  'With Lemon',
  'Light Brew',
  'Strong Brew',
];

const LOCATION_OPTS = [
  { id: 'Balaji Cabin', label: 'Balaji Cabin' },
  { id: 'RK Cabin', label: 'RK Cabin' },
  { id: 'Manisha Cabin', label: 'Manisha Cabin' },
  { id: 'Resume Cabin', label: 'Resume Cabin' },
  { id: 'Tech Team', label: 'Tech Team' },
  { id: 'Marketing Team', label: 'Marketing Team' },
  { id: 'Conference Room', label: 'Conference Room' },
  { id: 'Ask Every Time', label: 'Ask me every time' },
];

const SHIFT_OPTS = [
  {
    id: 'morning',
    emoji: '☀️',
    label: 'Morning Shift',
    sub: '9:00 AM – 5:00 PM',
    detail: 'Lunch served ~12:30 PM',
  },
  {
    id: 'night',
    emoji: '🌙',
    label: 'Night Shift',
    sub: '8:00 PM – 5:30 AM',
    detail: 'Dinner served ~11:00 PM',
  },
];

const TONE_OPTS_BASE = [
  {
    id: 'gen_z',
    emoji: '🔥',
    label: 'Gen-Z Vibes',
    example: '"Your coffee is on its way bestie! ☕🚀"',
  },
  {
    id: 'Friendly',
    emoji: '😊',
    label: 'Friendly',
    example: '"Coffee time! Should we send your usual?"',
  },
  {
    id: 'Professional',
    emoji: '👔',
    label: 'Professional',
    example: '"Your coffee reminder is ready."',
  },
  { id: 'Funny', emoji: '😄', label: 'Funny', example: '"Coffee is calling. Should we answer?"' },
  {
    id: 'Mom Mode',
    emoji: '💝',
    label: 'Mom Mode',
    example: '"Two days no coffee? Are you okay? 😄"',
  },
];
const TONE_BOYFRIEND = {
  id: 'boyfriend',
  emoji: '💕',
  label: 'Boyfriend Style',
  example: '"Hey cutie, your coffee\'s here 💖 Don\'t forget to eat lunch!"',
};
const TONE_GIRLFRIEND = {
  id: 'girlfriend',
  emoji: '💕',
  label: 'Girlfriend Style',
  example: '"Hey handsome, your chai is ready ☕💖 Stay hydrated!"',
};

function getToneOpts(gender) {
  const base = [...TONE_OPTS_BASE];
  if (gender === 'female') base.splice(1, 0, TONE_BOYFRIEND);
  if (gender === 'male') base.splice(1, 0, TONE_GIRLFRIEND);
  return base;
}
// For backward compat
const _TONE_OPTS = TONE_OPTS_BASE;

/* ── Reusable chip components ────────────────────────────────────── */
function MultiChip({ emoji, label, selected, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2 px-4 py-3 rounded-2xl border-2 font-medium text-sm transition-all active:scale-95 ${
        selected
          ? 'border-brand bg-brand text-white shadow-md shadow-brand/20'
          : 'border-slate-200 bg-white text-slate-700 hover:border-brand/40'
      }`}
    >
      <span className="text-lg">{emoji}</span>
      {label}
      {selected && <Check size={13} className="ml-auto shrink-0" />}
    </button>
  );
}

function SingleChip({ emoji, label, example, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-start gap-3 p-4 rounded-2xl border-2 w-full text-left transition-all active:scale-[0.99] ${
        selected ? 'border-brand bg-brand/5' : 'border-slate-200 hover:border-brand/30'
      }`}
    >
      {emoji && <span className="text-2xl shrink-0 mt-0.5">{emoji}</span>}
      <div className="min-w-0 flex-1">
        <div className={`font-semibold text-sm ${selected ? 'text-brand' : 'text-slate-800'}`}>
          {label}
        </div>
        {example && <div className="text-xs text-slate-400 mt-0.5 italic">{example}</div>}
      </div>
      {selected && <Check size={16} className="ml-auto shrink-0 text-brand mt-0.5" />}
    </button>
  );
}

function NavBar({ step, onBack, onNext, nextLabel = 'Next', nextDisabled = false }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-6 py-4 flex gap-3 max-w-lg mx-auto">
      {step > 0 && (
        <button
          type="button"
          onClick={onBack}
          className="btn-secondary flex items-center gap-1 px-4"
        >
          <ChevronLeft size={16} /> Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="btn-primary flex-1 py-3 text-base font-semibold disabled:opacity-40"
      >
        {nextLabel}
      </button>
    </div>
  );
}

/* ── Steps ────────────────────────────────────────────────────────── */

// Step 0 — Welcome
function StepWelcome({ onNext }) {
  return (
    <div className="text-center py-12 space-y-6">
      <motion.div
        animate={{ rotate: [0, -10, 10, -5, 5, 0] }}
        transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 3 }}
        className="text-8xl"
      >
        🍽️
      </motion.div>
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Welcome to
          <br />
          Office Café ☕
        </h1>
        <p className="text-slate-500 mt-3 text-base leading-relaxed">
          Order tea, coffee, snacks, lunch, and more — delivered to your desk in minutes.
          <br />
          <br />
          Let's set up your preferences in 30 seconds.
        </p>
      </div>
      <button onClick={onNext} className="btn-primary w-full py-4 text-lg font-bold">
        Get Started →
      </button>
    </div>
  );
}

// Step 1 — Preferred name + Employee Code
function StepName({ prefs, set, onNext, onBack }) {
  return (
    <div className="space-y-6 pb-28">
      <div className="text-center pt-4">
        <div className="text-5xl mb-3">👋</div>
        <h2 className="text-2xl font-bold text-slate-900">Let's get to know you!</h2>
        <p className="text-slate-500 mt-2 text-sm">
          The office boy will see this name when your order arrives.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1 mb-1.5 block">
            Your Name
          </label>
          <input
            className="w-full border-2 border-slate-200 rounded-2xl px-4 py-4 text-lg font-semibold text-slate-800 placeholder:text-slate-300 focus:border-brand focus:outline-none text-center"
            placeholder="e.g. Naga, Rama, RK…"
            value={prefs.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            maxLength={30}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1 mb-1.5 block">
            Employee Code <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            className="w-full border-2 border-slate-200 rounded-2xl px-4 py-4 text-2xl font-extrabold text-slate-800 placeholder:text-slate-300 focus:border-brand focus:outline-none text-center tracking-[0.3em]"
            placeholder="0001"
            value={prefs.employeeCode || ''}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 4);
              set('employeeCode', val);
            }}
            maxLength={4}
          />
          <p className="text-center text-[10px] text-slate-400 mt-1">
            4-digit number — shown on meal receipts and order tickets.
          </p>
        </div>

        <p className="text-center text-xs text-slate-400">
          Your order will say:{' '}
          <span className="font-bold text-slate-600">
            "{prefs.displayName || 'Your name'} ({prefs.employeeCode || '0000'}) needs 1x CCD Coffee
            🚀"
          </span>
        </p>
      </div>

      <NavBar
        step={1}
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!prefs.displayName?.trim() || (prefs.employeeCode || '').length !== 4}
      />
    </div>
  );
}

// Step 2 — Shift
function StepShift({ prefs, set, onNext, onBack }) {
  return (
    <div className="space-y-6 pb-28">
      <div className="text-center pt-4">
        <div className="text-5xl mb-3">⏰</div>
        <h2 className="text-2xl font-bold text-slate-900">What's your shift?</h2>
        <p className="text-slate-500 mt-2 text-sm">This decides your meal booking cutoff times.</p>
      </div>
      <div className="space-y-3">
        {SHIFT_OPTS.map(({ id, emoji, label, sub, detail }) => (
          <button
            key={id}
            type="button"
            onClick={() => set('shift', id)}
            className={`w-full p-5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${
              prefs.shift === id
                ? 'border-brand bg-brand/5 shadow-md shadow-brand/10'
                : 'border-slate-200 bg-white hover:border-brand/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">{emoji}</span>
              <div>
                <div
                  className={`font-bold text-base ${prefs.shift === id ? 'text-brand' : 'text-slate-800'}`}
                >
                  {label}
                  {prefs.shift === id && <Check size={14} className="inline ml-2" />}
                </div>
                <div className="text-sm text-slate-500">{sub}</div>
                <div className="text-xs text-slate-400 mt-0.5">{detail}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
      <NavBar step={2} onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 3 — Drinks (two-level: category → sub-options)
function StepDrinks({ prefs, toggle, onNext, onBack }) {
  // Track which categories are expanded
  const [expanded, setExpanded] = useState({});
  const selectedDrinks = prefs.drinks || [];

  // Check if any sub from a category is selected
  const hasCatSelection = (cat) => cat.subs?.some((s) => selectedDrinks.includes(s.id));

  function toggleCategory(cat) {
    if (cat.id === 'none') {
      toggle('None');
      return;
    }
    if (cat.id === 'water') {
      toggle('Water');
      return;
    }
    // Toggle expand/collapse
    setExpanded((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }));
  }

  return (
    <div className="space-y-6 pb-28">
      <div className="text-center pt-4">
        <div className="text-5xl mb-3">☕</div>
        <h2 className="text-2xl font-bold text-slate-900">What do you drink?</h2>
        <p className="text-slate-500 mt-2 text-sm">Tap a category, then pick your favourites.</p>
      </div>

      <div className="space-y-3">
        {DRINK_CATEGORIES.map((cat) => {
          const isExpanded = expanded[cat.id];
          const hasSubs = cat.subs && cat.subs.length > 0;
          const hasSelection = hasCatSelection(cat);

          // Simple items (Water, None)
          if (!hasSubs) {
            const isSelected =
              cat.id === 'none'
                ? selectedDrinks.includes('None')
                : selectedDrinks.includes('Water');
            return (
              <button
                key={cat.id}
                onClick={() => toggleCategory(cat)}
                className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                  isSelected
                    ? 'border-brand bg-brand/5'
                    : 'border-slate-200 bg-white hover:border-brand/30'
                }`}
              >
                <span className="text-2xl">{cat.emoji}</span>
                <span
                  className={`font-bold text-sm ${isSelected ? 'text-brand' : 'text-slate-700'}`}
                >
                  {cat.label}
                </span>
                {isSelected && <Check size={16} className="text-brand ml-auto" />}
              </button>
            );
          }

          // Category with sub-options
          return (
            <div key={cat.id}>
              <button
                onClick={() => toggleCategory(cat)}
                className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                  hasSelection
                    ? 'border-brand bg-brand/5'
                    : 'border-slate-200 bg-white hover:border-brand/30'
                }`}
              >
                <span className="text-2xl">{cat.emoji}</span>
                <div className="flex-1">
                  <span
                    className={`font-bold text-sm ${hasSelection ? 'text-brand' : 'text-slate-700'}`}
                  >
                    {cat.label}
                  </span>
                  {hasSelection && (
                    <div className="text-[10px] text-brand/70 mt-0.5">
                      {cat.subs
                        .filter((s) => selectedDrinks.includes(s.id))
                        .map((s) => s.label)
                        .join(', ')}
                    </div>
                  )}
                </div>
                <span
                  className={`text-xs font-bold transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                >
                  ▼
                </span>
              </button>

              {/* Sub-options grid */}
              {isExpanded && (
                <div className="grid grid-cols-2 gap-2 mt-2 ml-2 mr-2">
                  {cat.subs.map((sub) => (
                    <MultiChip
                      key={sub.id}
                      emoji={sub.emoji}
                      label={sub.label}
                      selected={selectedDrinks.includes(sub.id)}
                      onToggle={() => toggle(sub.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <NavBar step={3} onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 2 — Snacks
function StepSnacks({ prefs, toggle, onNext, onBack }) {
  return (
    <div className="space-y-6 pb-28">
      <div className="text-center pt-4">
        <div className="text-5xl mb-3">🍪</div>
        <h2 className="text-2xl font-bold text-slate-900">Snacks & food?</h2>
        <p className="text-slate-500 mt-2 text-sm">Select all that apply.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {SNACK_OPTS.map(({ id, emoji, label }) => (
          <MultiChip
            key={id}
            emoji={emoji}
            label={label}
            selected={prefs.snacks.includes(id)}
            onToggle={() => toggle(id)}
          />
        ))}
      </div>
      <NavBar step={4} onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 5 — Taste preferences (dynamic based on drink selection)
function StepTaste({ prefs, toggle, onNext, onBack }) {
  const drinks = prefs.drinks || [];
  const CCD_SUBS = ['Espresso', 'Latte', 'Cappuccino', 'Hot Chocolate', 'Badam Mix'];
  const _TEA_SUBS = ['Assam Tea', 'Elaichi Tea', 'Ginger Tea', 'Green Tea', 'Lemon Tea'];

  const hasCoffee = drinks.some((d) => CCD_SUBS.includes(d) || d.toLowerCase().includes('coffee'));
  const hasTea = drinks.some(
    (d) => ['Assam Tea', 'Elaichi Tea', 'Ginger Tea'].includes(d) || d === 'Regular Tea'
  );
  const hasGreenTea = drinks.includes('Green Tea');
  const hasLemon = drinks.includes('Lemon Tea');

  const groups = [];
  if (hasCoffee) groups.push({ label: '☕ Coffee — how do you take it?', opts: COFFEE_TASTE });
  if (hasTea) groups.push({ label: '🍵 Tea — how do you like it?', opts: TEA_TASTE });
  if (hasGreenTea) groups.push({ label: '🍃 Green Tea preference', opts: GREEN_TEA_TASTE });
  if (hasLemon) groups.push({ label: '🍋 Lemon Tea preference', opts: LEMON_TASTE });

  if (!groups.length) {
    return (
      <div className="space-y-6 pb-28">
        <div className="text-center pt-10 text-slate-400 space-y-3">
          <div className="text-5xl">🤷</div>
          <p className="text-sm">No hot drinks selected — skipping taste preferences.</p>
        </div>
        <NavBar step={5} onBack={onBack} onNext={onNext} nextLabel="Skip →" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-28">
      <div className="text-center pt-4">
        <div className="text-5xl mb-3">🎨</div>
        <h2 className="text-2xl font-bold text-slate-900">Your taste preference</h2>
        <p className="text-slate-500 mt-2 text-sm">Select all that apply.</p>
      </div>
      {groups.map(({ label, opts }) => (
        <div key={label}>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
            {label}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {opts.map((opt) => (
              <MultiChip
                key={opt}
                emoji=""
                label={opt}
                selected={prefs.tastes.includes(opt)}
                onToggle={() => toggle(opt)}
              />
            ))}
          </div>
        </div>
      ))}
      <NavBar step={5} onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 6 — Location
function StepLocation({ prefs, set, onNext, onBack }) {
  return (
    <div className="space-y-6 pb-28">
      <div className="text-center pt-4">
        <div className="text-5xl mb-3">📍</div>
        <h2 className="text-2xl font-bold text-slate-900">Where's your usual spot?</h2>
        <p className="text-slate-500 mt-2 text-sm">We'll pre-fill this when you order.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {LOCATION_OPTS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => set('location', id === prefs.location ? '' : id)}
            className={`p-3 rounded-2xl border-2 text-sm font-semibold transition-all active:scale-95 ${
              prefs.location === id
                ? 'border-brand bg-brand text-white shadow-md shadow-brand/20'
                : 'border-slate-200 bg-white text-slate-700 hover:border-brand/30'
            }`}
          >
            {prefs.location === id && <Check size={12} className="inline mr-1" />}
            {label}
          </button>
        ))}
      </div>
      <NavBar step={6} onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 7 — Reminders (shift-aware)
function StepReminders({ prefs, set, onNext, onBack, shift }) {
  const isNight = shift === 'night';

  const MORNING_ITEMS = [
    {
      key: 'morningReminder',
      label: '☀️ Morning drink',
      sub: 'Reminds you around 10:45 AM',
      timeKey: 'morningTime',
      defTime: '10:45',
    },
    {
      key: 'afternoonReminder',
      label: '🌤️ Afternoon drink',
      sub: 'Reminds you around 2:45 PM',
      timeKey: 'afternoonTime',
      defTime: '14:45',
    },
    {
      key: 'lunchReminder',
      label: '🍱 Lunch reminder',
      sub: 'Reminds you around 12:45 PM',
      timeKey: 'lunchTime',
      defTime: '12:45',
    },
    {
      key: 'waterReminder',
      label: '💧 Hydration nudge',
      sub: 'Drink water reminder',
      timeKey: null,
      defTime: null,
    },
  ];

  const NIGHT_ITEMS = [
    {
      key: 'eveningReminder',
      label: '🌙 Evening drink',
      sub: 'Reminds you around 9:30 PM',
      timeKey: 'eveningTime',
      defTime: '21:30',
    },
    {
      key: 'lateNightReminder',
      label: '🌛 Late night drink',
      sub: 'Reminds you around 1:00 AM',
      timeKey: 'lateNightTime',
      defTime: '01:00',
    },
    {
      key: 'dinnerReminder',
      label: '🍽️ Dinner reminder',
      sub: 'Reminds you around 11:00 PM',
      timeKey: 'dinnerTime',
      defTime: '23:00',
    },
    {
      key: 'waterReminder',
      label: '💧 Hydration nudge',
      sub: 'Drink water reminder',
      timeKey: null,
      defTime: null,
    },
  ];

  const items = isNight ? NIGHT_ITEMS : MORNING_ITEMS;

  return (
    <div className="space-y-6 pb-28">
      <div className="text-center pt-4">
        <div className="text-5xl mb-3">{isNight ? '🌙' : '🔔'}</div>
        <h2 className="text-2xl font-bold text-slate-900">Remind me to order?</h2>
        <p className="text-slate-500 mt-2 text-sm">
          {isNight
            ? '🌙 Night shift reminders — times adjusted for your shift.'
            : 'Toggle what you want. Change anytime in Settings.'}
        </p>
        {isNight && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 border border-indigo-200 rounded-full">
            <span className="text-xs text-indigo-700 font-bold">
              🌙 Night shift — self pickup only at night
            </span>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {items.map(({ key, label, sub, timeKey, defTime }) => (
          <div
            key={key}
            className={`p-4 rounded-2xl border-2 transition-all ${prefs[key] ? 'border-brand bg-brand/5' : 'border-slate-200 bg-white'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm text-slate-800">{label}</div>
                <div className="text-xs text-slate-500">{sub}</div>
              </div>
              <button
                type="button"
                onClick={() => set(key, !prefs[key])}
                className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${prefs[key] ? 'bg-brand' : 'bg-slate-300'}`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${prefs[key] ? 'left-6' : 'left-1'}`}
                />
              </button>
            </div>
            {prefs[key] && timeKey && (
              <input
                type="time"
                className="input mt-3 w-full"
                defaultValue={defTime}
                onChange={(e) => set(timeKey, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
      <NavBar step={7} onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 8 — Gender (for personalized notification tone)
function StepGender({ prefs, set, onNext, onBack }) {
  const GENDER_OPTS = [
    { id: 'male', emoji: '👨', label: 'Male' },
    { id: 'female', emoji: '👩', label: 'Female' },
    { id: 'other', emoji: '🧑', label: 'Prefer not to say' },
  ];
  return (
    <div className="space-y-6 pb-28">
      <div className="text-center pt-4">
        <div className="text-5xl mb-3">🙋</div>
        <h2 className="text-2xl font-bold text-slate-900">One quick thing...</h2>
        <p className="text-slate-500 mt-2 text-sm">
          This helps us personalize your notification style.
          <br />
          <span className="text-[10px] text-slate-400">
            Only used for AI tone — never shared with anyone.
          </span>
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {GENDER_OPTS.map(({ id, emoji, label }) => (
          <button
            key={id}
            onClick={() => set('gender', id)}
            className={`p-5 rounded-2xl border-2 text-center transition-all active:scale-95 ${
              prefs.gender === id
                ? 'border-brand bg-brand/5 shadow-md shadow-brand/10'
                : 'border-slate-200 bg-white hover:border-brand/30'
            }`}
          >
            <div className="text-3xl mb-2">{emoji}</div>
            <div
              className={`text-sm font-bold ${prefs.gender === id ? 'text-brand' : 'text-slate-700'}`}
            >
              {label}
              {prefs.gender === id && <Check size={12} className="inline ml-1" />}
            </div>
          </button>
        ))}
      </div>
      <NavBar step={8} onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 9 — Tone
function StepTone({ prefs, set, onNext, onBack }) {
  const toneOpts = getToneOpts(prefs.gender);
  return (
    <div className="space-y-6 pb-28">
      <div className="text-center pt-4">
        <div className="text-5xl mb-3">💬</div>
        <h2 className="text-2xl font-bold text-slate-900">How should we talk to you?</h2>
        <p className="text-slate-500 mt-2 text-sm">Controls notifications and AI personality.</p>
      </div>
      <div className="space-y-2">
        {toneOpts.map(({ id, emoji, label, example }) => (
          <SingleChip
            key={id}
            emoji={emoji}
            label={label}
            example={example}
            selected={prefs.tone === id}
            onSelect={() => set(id)}
          />
        ))}
      </div>
      <NavBar step={9} onBack={onBack} onNext={onNext} nextLabel="Almost Done →" />
    </div>
  );
}

// Step 10 — Done
function StepDone({ onFinish, saving }) {
  return (
    <div className="text-center py-16 space-y-6">
      <motion.div
        animate={{ scale: [1, 1.1, 1], rotate: [0, 5, -5, 0] }}
        transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 2 }}
        className="text-8xl"
      >
        🎉
      </motion.div>
      <div>
        <h1 className="text-3xl font-bold text-slate-900">All Set!</h1>
        <p className="text-slate-500 mt-3 text-base">
          Your Office Café is personalized and ready.
          <br />
          Order anything. We'll send it right to you.
        </p>
      </div>
      <button
        onClick={onFinish}
        disabled={saving}
        className="btn-primary w-full py-4 text-lg font-bold"
      >
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Saving…
          </span>
        ) : (
          '☕ Start Ordering'
        )}
      </button>
    </div>
  );
}

/* ── Main Onboarding ─────────────────────────────────────────────── */
const TOTAL = 11;

export default function Onboarding({ onComplete }) {
  const { session } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Pre-fill displayName from Microsoft profile (full_name or email prefix)
  const defaultName = (() => {
    const meta = session?.user?.user_metadata;
    const name = meta?.full_name || meta?.name || meta?.preferred_username || '';
    return name.split(' ')[0] || '';
  })();

  const [prefs, setPrefs] = useState({
    displayName: defaultName,
    employeeCode: '',
    drinks: [],
    snacks: [],
    tastes: [],
    shift: 'morning',
    location: '',
    // Morning shift reminders
    morningReminder: true,
    morningTime: '10:45',
    afternoonReminder: false,
    afternoonTime: '14:45',
    lunchReminder: false,
    lunchTime: '12:45',
    waterReminder: false,
    // Night shift reminders
    eveningReminder: true,
    eveningTime: '21:30',
    lateNightReminder: false,
    lateNightTime: '01:00',
    dinnerReminder: false,
    dinnerTime: '23:00',
    gender: '',
    tone: 'gen_z',
  });

  function toggleArr(field, value) {
    setPrefs((p) => ({
      ...p,
      [field]: p[field].includes(value)
        ? p[field].filter((x) => x !== value)
        : [...p[field], value],
    }));
  }

  // Snack selection enforces mutual exclusivity with the 'none' sentinel.
  // 'No Snacks' clears all real snacks; any real snack clears 'none'.
  function toggleSnack(value) {
    setPrefs((p) => {
      if (value === 'none') {
        return { ...p, snacks: p.snacks.includes('none') ? [] : ['none'] };
      }
      const base = p.snacks.filter((s) => s !== 'none');
      return {
        ...p,
        snacks: base.includes(value) ? base.filter((s) => s !== value) : [...base, value],
      };
    });
  }
  function set(field, value) {
    setPrefs((p) => ({ ...p, [field]: value }));
  }

  const next = () => setStep((s) => Math.min(s + 1, TOTAL - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Timeout wrapper — never let a save hang forever
  function withTimeout(promise, ms = 8000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Save timed out')), ms)),
    ]);
  }

  async function savePrefs(data) {
    console.log('[Onboarding] savePrefs called with:', JSON.stringify(data));
    try {
      const { data: result, error } = await withTimeout(
        supabase
          .from('employee_cafeteria_preferences')
          .upsert(data, { onConflict: 'user_id' })
          .select()
      );
      console.log('[Onboarding] savePrefs result:', result, 'error:', error?.message);
      if (error) throw error;
    } catch (e) {
      console.error('[Onboarding] savePrefs error:', e.message || e);
      throw e;
    }
  }

  async function finish() {
    setSaving(true);
    try {
      // Save preferred name + employee code back to profiles
      const profileUpdate = {};
      if (prefs.displayName?.trim()) profileUpdate.preferred_name = prefs.displayName.trim();
      if (prefs.employeeCode?.trim())
        profileUpdate.employee_code = prefs.employeeCode.trim().toUpperCase();
      if (Object.keys(profileUpdate).length > 0) {
        await supabase.from('profiles').update(profileUpdate).eq('id', session.user.id);
      }

      await savePrefs({
        user_id: session.user.id,
        preferred_name: prefs.displayName?.trim() || null,
        drink_prefs: prefs.drinks.filter((d) => d !== 'None'),
        snack_prefs: prefs.snacks.includes('none') ? [] : prefs.snacks,
        taste_prefs: prefs.tastes,
        shift: prefs.shift || 'morning',
        preferred_location: prefs.location || null,
        gender: prefs.gender || null,
        reminder_enabled:
          prefs.morningReminder ||
          prefs.afternoonReminder ||
          prefs.lunchReminder ||
          prefs.waterReminder ||
          prefs.eveningReminder ||
          prefs.lateNightReminder ||
          prefs.dinnerReminder ||
          false,
        // Save the primary reminder time based on shift
        reminder_time:
          prefs.shift === 'night' ? prefs.eveningTime || '21:30' : prefs.morningTime || '10:45',
        notification_tone: prefs.tone || 'gen_z',
        onboarding_completed: true,
      });
    } catch (e) {
      console.warn('[Onboarding] finish save failed, continuing anyway:', e.message);
    }
    // Always proceed — never block the user from using the app
    setSaving(false);
    onComplete(prefs);
  }

  async function skip() {
    setSaving(true);
    try {
      await savePrefs({
        user_id: session.user.id,
        notification_tone: 'gen_z',
        onboarding_completed: true,
      });
    } catch (e) {
      console.warn('[Onboarding] skip save failed, continuing anyway:', e.message);
    }
    // Always proceed — never block the user
    setSaving(false);
    onComplete({});
  }

  const steps = [
    <StepWelcome key={0} onNext={next} />,
    <StepName key={1} prefs={prefs} set={set} onNext={next} onBack={back} />,
    <StepShift key={2} prefs={prefs} set={set} onNext={next} onBack={back} />,
    <StepDrinks
      key={3}
      prefs={prefs}
      toggle={(v) => toggleArr('drinks', v)}
      onNext={next}
      onBack={back}
    />,
    <StepSnacks
      key={4}
      prefs={prefs}
      toggle={toggleSnack}
      onNext={next}
      onBack={back}
    />,
    <StepTaste
      key={5}
      prefs={prefs}
      toggle={(v) => toggleArr('tastes', v)}
      onNext={next}
      onBack={back}
    />,
    <StepLocation key={6} prefs={prefs} set={set} onNext={next} onBack={back} />,
    <StepReminders
      key={7}
      prefs={prefs}
      set={set}
      onNext={next}
      onBack={back}
      shift={prefs.shift}
    />,
    <StepGender key={8} prefs={prefs} set={set} onNext={next} onBack={back} />,
    <StepTone key={9} prefs={prefs} set={(v) => set('tone', v)} onNext={next} onBack={back} />,
    <StepDone key={10} onFinish={finish} saving={saving} />,
  ];

  return (
    <div className="fixed inset-0 z-[200] bg-white flex flex-col overflow-hidden">
      {/* ── Progress bar ── */}
      <div className="px-6 pt-5 pb-2 flex items-center gap-3">
        <div className="flex gap-1 flex-1">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step
                  ? 'flex-[2] bg-brand'
                  : i < step
                    ? 'flex-1 bg-brand/40'
                    : 'flex-1 bg-slate-100'
              }`}
            />
          ))}
        </div>
        {step > 0 && step < TOTAL - 1 && (
          <button
            onClick={skip}
            disabled={saving}
            className="text-xs text-slate-400 hover:text-slate-600 whitespace-nowrap"
          >
            Skip setup
          </button>
        )}
      </div>

      {/* Step counter */}
      <div className="text-center text-xs text-slate-400 pb-1">
        {step + 1} of {TOTAL}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-6 py-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.2 }}
            >
              {steps[step]}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
