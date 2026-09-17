import { AnimatePresence, motion } from 'framer-motion';
import { Citrus, Coffee, Leaf, MapPin, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';

// Applywizz office locations
const LOCATIONS = [
  'Balaji Cabin',
  'RK Cabin',
  'Manisha Cabin',
  'Resume Cabin',
  'Tech Team',
  'Marketing Team',
  'Conference Room',
];

const _SAMPLES = ['Coffee please', 'Water bottle for 2', 'Tea, no sugar'];

export default function RequestSubmit() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [followup, setFollowup] = useState('');

  const getNudgeContent = () => {
    // If Mom Mode is active (based on user preference)
    if (profile?.personality === 'mom') {
      const jokes = [
        "I saw you skip lunch! If you don't have a Peanut Butter sandwich right now, I'm telling HR! 🥪👵",
        "It's getting late! Have a hot Ginger Tea before you start looking like a zombie. ☕️🧟",
        "Your desk looks empty. Should I send some biscuits so you don't starve before 5 PM? 🍪",
        'Are you drinking enough water? Or do I need to come there and check? 💧🤨',
      ];
      return jokes[Math.floor(Math.random() * jokes.length)];
    }
    return "It's 10:45 AM. Want your usual CCD Coffee sent to Cabin 2? ☕";
  };

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    setOkMsg('');
    setFollowup('');
    try {
      const combined = location ? `${text.trim()} (Location: ${location})` : text.trim();
      const r = await api.submitRequest(combined);
      if (r.needs_followup) {
        setFollowup(r.followup);
      } else {
        setOkMsg(`Got it. "${r.request.instruction}"`);
        setText('');
        setLocation('');
        setTimeout(() => {
          navigate(`/track/${r.request.id}`);
        }, 1500);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-2xl"
      >
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">
            Office <span className="text-brand">Concierge</span>
          </h1>
          <p className="text-slate-500 mt-2 font-medium">
            How can we make your day better, {profile?.full_name?.split(' ')[0] || 'Rama'}?
          </p>
        </div>

        {/* 🌟 SMART NUDGE (Zomato Style) */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="mb-8 relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-brand to-rose-500 p-6 text-white shadow-xl shadow-brand/20 border border-white/20"
        >
          <div className="relative z-10 flex items-center justify-between gap-6">
            <div className="space-y-1">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Sparkles size={18} className="text-amber-300 fill-amber-300" />
                {profile?.personality === 'mom' ? 'Mom is Watching! 👵' : 'Your Usual?'}
              </h3>
              <p className="text-sm opacity-90 leading-relaxed max-w-sm font-medium">
                "{getNudgeContent()}"
              </p>
            </div>
            <button
              onClick={() => setText('Send my usual CCD Coffee to Cabin 2')}
              className="bg-white text-brand px-6 py-3 rounded-2xl font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-lg shrink-0"
            >
              Send Coffee
            </button>
          </div>
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        </motion.div>

        {/* 🚀 QUICK REORDER (Swiggy Style) */}
        <div className="mb-10 space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">
              Your Go-To Items
            </h2>
            <div className="h-[1px] flex-1 bg-slate-100 mx-4" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { name: 'CCD Coffee', icon: <Coffee />, color: 'bg-orange-50', text: 'Coffee' },
              { name: 'Assam Tea', icon: <Leaf />, color: 'bg-emerald-50', text: 'Tea' },
              { name: 'Lemon Tea', icon: <Citrus />, color: 'bg-yellow-50', text: 'Lemon' },
            ].map((item) => (
              <motion.button
                whileHover={{ y: -4, scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                key={item.name}
                onClick={() => setText(`Get me ${item.name}`)}
                className="p-5 bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col items-center gap-3 text-center group hover:border-brand/30 transition-all"
              >
                <div
                  className={`w-14 h-14 ${item.color} rounded-2xl flex items-center justify-center text-brand group-hover:scale-110 transition-transform`}
                >
                  {item.icon}
                </div>
                <span className="text-[11px] font-black text-slate-600 uppercase tracking-wider">
                  {item.text}
                </span>
              </motion.button>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="absolute -top-10 -left-10 w-32 h-32 bg-brand/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl" />

          <form
            onSubmit={submit}
            className="relative z-10 backdrop-blur-xl bg-white/70 border border-white/50 shadow-2xl rounded-3xl p-8 space-y-8"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-widest">
                  Delivery Location
                </label>
                {location && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="text-[10px] bg-brand/10 text-brand px-2 py-0.5 rounded-full font-bold uppercase"
                  >
                    Selected
                  </motion.span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {LOCATIONS.map((loc) => (
                  <button
                    type="button"
                    key={loc}
                    className={`
                      relative group h-20 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-1
                      ${
                        location === loc
                          ? 'bg-brand border-brand text-white shadow-lg shadow-brand/20 scale-105'
                          : 'bg-white/50 border-slate-100 text-slate-600 hover:border-brand/30 hover:bg-white'
                      }
                    `}
                    onClick={() => setLocation(loc === location ? '' : loc)}
                  >
                    <MapPin
                      size={20}
                      className={
                        location === loc ? 'text-white' : 'text-slate-400 group-hover:text-brand'
                      }
                    />
                    <span className="text-[10px] font-bold uppercase tracking-tight">{loc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-sm font-bold text-slate-700 uppercase tracking-widest block">
                Your Request
              </label>
              <div className="relative group">
                <textarea
                  className="w-full bg-white/50 border-2 border-slate-100 rounded-2xl p-4 text-slate-800 placeholder:text-slate-400 focus:border-brand focus:ring-0 transition-all min-h-[120px] text-lg shadow-inner"
                  placeholder="e.g. 2 Hot Coffees for a client meeting"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  required
                  minLength={3}
                  maxLength={500}
                />
              </div>
            </div>

            <AnimatePresence mode="wait">
              {followup && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="bg-amber-50 p-4 rounded-2xl text-sm flex gap-3 border border-amber-100"
                >
                  <span className="text-xl">🤔</span>
                  <div>
                    <div className="font-bold">Clarification:</div>
                    {followup}
                  </div>
                </motion.div>
              )}
              {okMsg && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-emerald-500 text-white p-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  <span>✅</span> {okMsg}
                </motion.div>
              )}
              {err && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-rose-50 text-rose-700 p-4 rounded-2xl text-sm font-medium border border-rose-100"
                >
                  {err}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="pt-4 flex flex-col gap-4">
              <button
                className="w-full h-14 bg-brand text-white rounded-2xl font-bold text-lg shadow-xl shadow-brand/30 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                disabled={busy || text.trim().length < 3}
              >
                {busy ? (
                  <div className="h-6 w-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>🚀 Send to Office Boy</>
                )}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
