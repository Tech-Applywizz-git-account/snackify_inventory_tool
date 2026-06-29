import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Coffee,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  Save,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { getPushStatus, subscribeToPush, unsubscribeFromPush } from '../lib/push.js';
import { supabase } from '../lib/supabase.js';

const TONES = [
  { value: 'Professional', label: 'Professional' },
  { value: 'Friendly', label: 'Friendly' },
  { value: 'Funny', label: 'Funny' },
  { value: 'Mom Mode', label: '💝 Mom Mode' },
  { value: 'Minimal', label: 'Minimal' },
  { value: 'gen_z', label: 'Gen-Z' },
  { value: 'boyfriend', label: 'Boyfriend 💖' },
  { value: 'girlfriend', label: 'Girlfriend 💖' },
];

export default function Preferences() {
  const { profile, session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [pushStatus, setPushStatus] = useState('checking');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [prefs, setPrefs] = useState({
    tea_coffee_reminder_enabled: false,
    reminder_interval_hours: 2,
    preferred_drink: 'Tea',
    notification_enabled: true,
    notification_tone: 'Friendly',
  });
  const [shift, setShift] = useState('morning');
  const [shiftSaving, setShiftSaving] = useState(false);
  const [employeeCode, setEmployeeCode] = useState('');
  const [codeSaving, setCodeSaving] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    const id = profile.id;

    supabase
      .from('employee_cafeteria_preferences')
      .select('notification_tone, reminder_enabled, reminder_time, preferred_drink')
      .eq('user_id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setPrefs((p) => ({
            ...p,
            notification_tone: data.notification_tone || 'Friendly',
            tea_coffee_reminder_enabled: data.reminder_enabled || false,
            preferred_drink: data.preferred_drink || 'Tea',
          }));
        }
      })
      .catch((e) => console.error('Failed to load preferences', e))
      .finally(() => setLoading(false));

    supabase
      .from('employee_cafeteria_preferences')
      .select('shift')
      .eq('user_id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.shift) setShift(data.shift);
      })
      .catch((e) => console.error('Failed to load shift', e));

    supabase
      .from('profiles')
      .select('employee_code')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.employee_code) setEmployeeCode(data.employee_code);
      })
      .catch(() => {});

    getPushStatus()
      .then(setPushStatus)
      .catch(() => setPushStatus('unsupported'));
  }, [profile?.id]);

  async function saveEmployeeCode() {
    if (!employeeCode.trim()) return;
    setCodeSaving(true);
    try {
      await supabase
        .from('profiles')
        .update({ employee_code: employeeCode.trim().toUpperCase() })
        .eq('id', profile.id);
    } catch (_) {}
    setCodeSaving(false);
  }

  async function saveShift(newShift) {
    setShift(newShift);
    setShiftSaving(true);
    try {
      await supabase
        .from('employee_cafeteria_preferences')
        .upsert({ user_id: profile.id, shift: newShift }, { onConflict: 'user_id' });
    } catch (e) {
      console.error('Failed to save shift', e);
    } finally {
      setShiftSaving(false);
    }
  }

  async function togglePush() {
    setPushBusy(true);
    setPushMsg('');
    try {
      const token = session?.access_token;
      if (pushStatus === 'subscribed') {
        await unsubscribeFromPush(token);
        setPushStatus('not_subscribed');
        setPushMsg('Push notifications disabled.');
      } else {
        await subscribeToPush(token);
        setPushStatus('subscribed');
        setPushMsg("Push notifications enabled! You'll be notified when orders update.");
      }
    } catch (e) {
      setPushMsg(e.message);
    } finally {
      setPushBusy(false);
    }
  }

  async function savePrefs() {
    setSaving(true);
    setSuccess(false);
    try {
      const { error } = await supabase.from('employee_cafeteria_preferences').upsert(
        {
          user_id: profile.id,
          notification_tone: prefs.notification_tone,
          reminder_enabled: prefs.tea_coffee_reminder_enabled,
          preferred_drink: prefs.preferred_drink,
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      alert(`Error saving preferences: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading settings...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 text-sm">
          Your account preferences and notification settings.
        </p>
      </div>

      {/* Profile info */}
      <div className="card space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-brand text-white grid place-items-center font-bold text-lg shrink-0">
            {(profile?.full_name || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900 truncate">{profile?.full_name || '—'}</div>
            <div className="text-xs text-slate-500 truncate">{profile?.email || '—'}</div>
            <div className="text-xs text-brand font-medium capitalize mt-0.5">
              {profile?.role?.replace('_', ' ') || '—'}
            </div>
          </div>
          <button
            className="ml-auto btn-secondary text-sm flex items-center gap-1 shrink-0"
            onClick={() => supabase.auth.signOut()}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>

        {/* Employee Code */}
        <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
          <div className="flex-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Employee Code
            </label>
            <input
              type="text"
              inputMode="numeric"
              className="w-full mt-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-extrabold text-slate-800 placeholder:text-slate-300 focus:border-brand focus:outline-none tracking-widest"
              placeholder="0001"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onBlur={saveEmployeeCode}
              maxLength={4}
            />
          </div>
          {codeSaving && <Loader2 size={16} className="animate-spin text-brand mt-5" />}
        </div>
      </div>

      {/* Shift Selection */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Sun size={18} className="text-brand" /> Work Shift
        </h2>
        <p className="text-xs text-slate-500">
          Your meal booking cutoff times depend on your shift.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => saveShift('morning')}
            disabled={shiftSaving}
            className={`flex items-center justify-center gap-2 p-4 rounded-xl border-2 font-bold text-sm transition-all ${
              shift === 'morning'
                ? 'bg-amber-50 border-amber-400 text-amber-700 shadow-md'
                : 'bg-white border-slate-200 text-slate-500 hover:border-amber-300'
            }`}
          >
            <Sun size={20} /> Morning
          </button>
          <button
            onClick={() => saveShift('night')}
            disabled={shiftSaving}
            className={`flex items-center justify-center gap-2 p-4 rounded-xl border-2 font-bold text-sm transition-all ${
              shift === 'night'
                ? 'bg-indigo-50 border-indigo-400 text-indigo-700 shadow-md'
                : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'
            }`}
          >
            <Moon size={20} /> Night
          </button>
        </div>
        {shift === 'morning' && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            Book by <strong>6 PM</strong> for next day's lunch. Cancel till <strong>8 PM</strong>.
          </p>
        )}
        {shift === 'night' && (
          <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-3 py-2">
            Book by <strong>2 PM</strong> for same day's dinner. Cancel till <strong>5 PM</strong>.
          </p>
        )}
      </div>

      <div className="card space-y-8">
        {/* Tea & Coffee Reminders */}
        <div className="space-y-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Coffee size={18} className="text-brand" /> Tea &amp; Coffee Reminders
          </h2>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div>
              <div className="font-medium text-slate-900 text-sm">Enable Reminders</div>
              <div className="text-xs text-slate-500">
                Get nudged every few hours to stay refreshed
              </div>
            </div>
            <button
              onClick={() =>
                setPrefs((p) => ({
                  ...p,
                  tea_coffee_reminder_enabled: !p.tea_coffee_reminder_enabled,
                }))
              }
              className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${prefs.tea_coffee_reminder_enabled ? 'bg-brand' : 'bg-slate-300'}`}
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${prefs.tea_coffee_reminder_enabled ? 'left-7' : 'left-1'}`}
              />
            </button>
          </div>

          <div
            className={`grid grid-cols-1 sm:grid-cols-2 gap-4 transition-opacity ${prefs.tea_coffee_reminder_enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}
          >
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">
                Interval
              </label>
              <select
                value={prefs.reminder_interval_hours}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, reminder_interval_hours: parseInt(e.target.value, 10) }))
                }
                className="input w-full"
              >
                <option value={1}>Every 1 hour</option>
                <option value={2}>Every 2 hours</option>
                <option value={3}>Every 3 hours</option>
                <option value={4}>Every 4 hours</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">
                Preferred Drink
              </label>
              <select
                value={prefs.preferred_drink}
                onChange={(e) => setPrefs((p) => ({ ...p, preferred_drink: e.target.value }))}
                className="input w-full"
              >
                <option>Tea</option>
                <option>Coffee</option>
                <option>Water</option>
              </select>
            </div>
          </div>
        </div>

        {/* Push Notifications */}
        <div className="space-y-4 pt-4 border-t border-slate-100">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Bell size={18} className="text-brand" /> Push Notifications
          </h2>

          {pushStatus === 'unsupported' ? (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-400">
              Push notifications are not supported in this browser.
            </div>
          ) : pushStatus === 'denied' ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              <strong>Blocked by browser.</strong> Click the lock icon in your browser address bar,
              reset notifications permission, then refresh.
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center gap-3">
                {pushStatus === 'subscribed' ? (
                  <BellRing size={18} className="text-brand" />
                ) : (
                  <BellOff size={18} className="text-slate-400" />
                )}
                <div>
                  <div className="font-medium text-slate-900 text-sm">
                    {pushStatus === 'subscribed' ? 'Notifications ON' : 'Notifications OFF'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {pushStatus === 'subscribed'
                      ? "You'll get notified when your order status changes"
                      : 'Tap to enable — office boy gets notified on new orders'}
                  </div>
                </div>
              </div>
              <button
                onClick={togglePush}
                disabled={pushBusy || pushStatus === 'checking'}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${pushStatus === 'subscribed' ? 'bg-brand' : 'bg-slate-300'}`}
              >
                {pushBusy ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  </div>
                ) : (
                  <div
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${pushStatus === 'subscribed' ? 'left-7' : 'left-1'}`}
                  />
                )}
              </button>
            </div>
          )}

          {pushMsg && (
            <div
              className={`text-xs p-3 rounded-xl ${pushMsg.includes('enabled') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}
            >
              {pushMsg}
            </div>
          )}
        </div>

        {/* AI Tone */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h2 className="text-base font-semibold">AI Personality Tone</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TONES.map((t) => (
              <button
                key={t.value}
                onClick={() => setPrefs((p) => ({ ...p, notification_tone: t.value }))}
                className={`p-3 rounded-xl border text-sm font-medium transition-all text-center ${
                  prefs.notification_tone === t.value
                    ? 'bg-brand text-white border-brand shadow-md'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-brand/40'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {prefs.notification_tone === 'Mom Mode' && (
            <p className="text-xs text-brand italic">
              Mom Mode is warm and caring — the most "at-home" office experience.
            </p>
          )}
          {prefs.notification_tone === 'boyfriend' && (
            <p className="text-xs text-brand italic">
              Boyfriend mode is sweet, caring, and protective. 💕
            </p>
          )}
          {prefs.notification_tone === 'girlfriend' && (
            <p className="text-xs text-brand italic">
              Girlfriend mode is playful, cute, and loving. 💖
            </p>
          )}
          {prefs.notification_tone === 'gen_z' && (
            <p className="text-xs text-brand italic">
              Gen-Z mode is no cap, aesthetic, and lowkey savage. 🔥
            </p>
          )}
        </div>

        <button
          className="btn-primary w-full py-3 flex items-center justify-center gap-2"
          onClick={savePrefs}
          disabled={saving}
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>

        <AnimatePresence>
          {success && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-center text-emerald-600 flex items-center justify-center gap-1 text-sm font-medium"
            >
              <CheckCircle2 size={16} /> Preferences saved!
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Security Info */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <KeyRound size={18} className="text-brand" /> Security
        </h2>
        <p className="text-xs text-slate-500">
          Your account is secured with <strong>Microsoft Authenticator</strong>. If you lose access
          to your authenticator app, contact your admin to reset it.
        </p>
      </div>

      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex gap-3 text-slate-600">
        <ShieldCheck size={20} className="shrink-0 text-brand mt-0.5" />
        <p className="text-xs leading-relaxed">
          <strong>Privacy:</strong> Your preferences are visible only to you and the system admin.
          The Office Boy only sees requests when they are submitted.
        </p>
      </div>
    </div>
  );
}
