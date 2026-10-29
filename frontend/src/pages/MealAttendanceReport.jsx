import { Download, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ImpersonationBanner from '../components/ImpersonationBanner.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';
import { exitImpersonation, logoutWhileImpersonating } from '../lib/impersonation.js';
import { downloadShiftAttendancePdf } from '../lib/mealAttendancePdf.js';
import { supabase } from '../lib/supabase.js';

/** Vendor QR check-in reliable from this date — attendance before this is incomplete. */
const MEAL_CHECKIN_DATA_START = '2026-10-10';

const LISTS = [
  {
    key: 'summary',
    label: 'Summary',
    meaning: 'Simple counts for this shift and date range.',
  },
  {
    key: 'rarely_book',
    label: 'Rarely book',
    meaning: 'Active people who booked a meal on fewer than half of the working days in this range.',
  },
  {
    key: 'booked_no_collect',
    label: 'Booked, did not collect',
    meaning: 'People who booked veg / egg / non-veg but never scanned QR to collect the meal.',
  },
  {
    key: 'did_not_book',
    label: 'Did not book',
    meaning: 'Active people on this shift with no meal booking at all in this range.',
  },
];

function clampFromDate(fromDate, toDate) {
  const floor = MEAL_CHECKIN_DATA_START;
  const clamped = fromDate < floor ? floor : fromDate;
  return clamped <= toDate ? clamped : floor;
}

function getISTDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysIso(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

function formatDateLabel(date) {
  if (!date) return '—';
  return new Date(`${date}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatChoice(choice) {
  if (!choice) return '—';
  return String(choice).replaceAll('_', ' ');
}

function matchesQuery(row, query) {
  if (!query) return true;
  const haystack = `${row.name || ''} ${row.email || ''} ${row.employee_code || ''}`.toLocaleLowerCase();
  return haystack.includes(query);
}

function StatCard({ title, value, meaning, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white',
    green: 'border-emerald-200 bg-emerald-50',
    blue: 'border-blue-200 bg-blue-50',
    red: 'border-rose-200 bg-rose-50',
    amber: 'border-amber-200 bg-amber-50',
  };
  const valueTone = {
    slate: 'text-slate-900',
    green: 'text-emerald-800',
    blue: 'text-blue-800',
    red: 'text-rose-800',
    amber: 'text-amber-800',
  };

  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${valueTone[tone]}`}>{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{meaning}</p>
    </div>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function SimpleTable({ headers, rows, emptyTitle, emptyDetail }) {
  if (!rows.length) return <EmptyState title={emptyTitle} detail={emptyDetail} />;

  return (
    <>
      <div className="space-y-3 p-3 md:hidden">
        {rows.map((row, index) => (
          <article
            key={row.key || index}
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <p className="font-semibold text-slate-900">
              {index + 1}. {row.title}
            </p>
            <p className="mt-1 text-xs text-slate-500">{row.subtitle}</p>
            {row.lines?.map((line) => (
              <p key={line} className="mt-1 text-xs text-slate-700">
                {line}
              </p>
            ))}
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">#</th>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={row.key || index} className="hover:bg-slate-50">
                <td className="px-4 py-3 tabular-nums text-slate-500">{index + 1}</td>
                {row.cells.map((cell, cellIndex) => (
                  <td key={`${row.key}-${cellIndex}`} className="px-4 py-3 text-slate-800">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
        {rows.length} people in this list
      </p>
    </>
  );
}

function ShiftPanel({
  report,
  loading,
  shift,
  listKey,
  onListChange,
  query,
  onQueryChange,
  onDownload,
  downloading,
  canDownload,
  rangeLabel,
  skippedNoScanDates = [],
  includedScanDates = [],
}) {
  const summary = report?.summary || {};
  const byChoice = report?.by_choice || {};
  const rarelyBook = report?.irregular_bookers || [];
  const bookedNoCollect = report?.booked_absent || [];
  const didNotBook = report?.not_booked || [];
  const q = query.trim().toLocaleLowerCase();
  const activeList = LISTS.find((item) => item.key === listKey) || LISTS[0];
  const skippedDates = skippedNoScanDates.length
    ? skippedNoScanDates
    : report?.skipped_no_scan_dates || [];
  const scanDates = includedScanDates.length
    ? includedScanDates
    : report?.included_scan_dates || [];

  const dash = loading ? '—' : null;
  const served = dash ?? summary.served ?? 0;
  const booked = dash ?? summary.booked ?? 0;
  const active = dash ?? summary.total_active ?? 0;
  const balanced = dash ?? summary.balanced ?? 0;
  const notBookedCount = dash ?? summary.not_booked ?? 0;
  const skipped = dash ?? summary.skipped ?? 0;
  const attendance = dash ?? `${summary.attendance_percent ?? 0}%`;

  return (
    <div className="space-y-4">
      {skippedDates.length > 0 ? (
        <div
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950"
        >
          <p className="text-sm font-bold">
            {skippedDates.length} day{skippedDates.length === 1 ? '' : 's'} skipped (no QR scanning)
          </p>
          <p className="mt-1 text-sm text-amber-900/90">
            These dates had meal bookings, but the vendor check-in page recorded{' '}
            <strong>zero scans</strong>. They are removed from booked / collected / did-not-collect
            counts so the report stays fair.
          </p>
          <p className="mt-2 text-xs font-medium text-amber-900">
            Skipped dates: {skippedDates.map((date) => formatDateLabel(date)).join(' · ')}
          </p>
          {scanDates.length > 0 ? (
            <p className="mt-1 text-xs text-amber-800">
              Counts below use only scanned days:{' '}
              {scanDates.map((date) => formatDateLabel(date)).join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              {shift === 'night' ? 'Night shift' : 'Day shift'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Selected range: <strong>{rangeLabel}</strong>
              {!loading && scanDates.length > 0 ? (
                <>
                  {' '}
                  · Using <strong>{scanDates.length}</strong> scanned day
                  {scanDates.length === 1 ? '' : 's'}
                </>
              ) : null}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Read the boxes below first. Each one says what the number means.
            </p>
          </div>
          <button
            type="button"
            onClick={onDownload}
            disabled={!canDownload}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-800 px-4 text-sm font-bold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Download size={15} className={downloading ? 'animate-bounce' : ''} />
            {downloading ? 'Creating PDF…' : 'Download this shift PDF'}
          </button>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 lg:p-5">
          <StatCard
            title="1. Active people"
            value={active}
            meaning="How many people are on this shift and can book meals."
          />
          <StatCard
            title="2. Booked a meal"
            value={booked}
            meaning="Meal bookings on scanned days only (veg, egg, or non-veg)."
            tone="green"
          />
          <StatCard
            title="3. Collected meal"
            value={served}
            meaning="Booked meals that were collected with QR check-in."
            tone="blue"
          />
          <StatCard
            title="4. Booked, did not collect"
            value={balanced}
            meaning="Booked on a scanned day but did not collect. Zero-scan days are not counted here."
            tone="red"
          />
          <StatCard
            title="5. Did not book"
            value={notBookedCount}
            meaning="Active people with no booking on the scanned days in this report."
            tone="amber"
          />
          <StatCard
            title="6. Said skip"
            value={skipped}
            meaning="People who chose Skip on scanned days."
          />
        </div>

        <div className="border-t border-slate-100 px-5 py-4">
          <p className="text-sm font-semibold text-slate-800">In one line</p>
          <p className="mt-1 text-sm text-slate-600">
            On scanned days only: out of <strong>{booked}</strong> booked meals,{' '}
            <strong>{served}</strong> were collected ({attendance} attendance).{' '}
            <strong>{balanced}</strong> were booked but not collected.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-slate-700">
              Veg: <strong>{loading ? '—' : byChoice.veg || 0}</strong>
            </span>
            <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-slate-700">
              Non-veg: <strong>{loading ? '—' : byChoice.non_veg || 0}</strong>
            </span>
            <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-slate-700">
              Egg: <strong>{loading ? '—' : byChoice.egg || 0}</strong>
            </span>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-emerald-800" />
            <h3 className="font-bold text-slate-950">People lists</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Open a list to see names. The blue note under the tabs always explains what you are looking at.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <nav className="flex max-w-full gap-1 overflow-x-auto" aria-label="People lists">
            {LISTS.map((list) => {
              const count =
                list.key === 'rarely_book'
                  ? rarelyBook.length
                  : list.key === 'booked_no_collect'
                    ? bookedNoCollect.length
                    : list.key === 'did_not_book'
                      ? didNotBook.length
                      : null;
              return (
                <button
                  key={list.key}
                  type="button"
                  aria-pressed={listKey === list.key}
                  onClick={() => onListChange(list.key)}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-bold transition-colors ${
                    listKey === list.key
                      ? 'bg-emerald-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {list.label}
                  {count != null ? (
                    <span className={listKey === list.key ? 'text-emerald-100' : 'text-slate-400'}>
                      {loading ? '—' : count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          {listKey !== 'summary' ? (
            <label className="relative block w-full lg:max-w-xs">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search name or email"
                className="min-h-11 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
              />
            </label>
          ) : null}
        </div>

        <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-3">
          <p className="text-sm font-semibold text-emerald-950">{activeList.label}</p>
          <p className="mt-0.5 text-sm text-emerald-900/80">{activeList.meaning}</p>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-slate-500">Loading…</p>
        ) : listKey === 'summary' ? (
          <div className="space-y-3 p-5">
            {LISTS.filter((list) => list.key !== 'summary').map((list) => {
              const count =
                list.key === 'rarely_book'
                  ? rarelyBook.length
                  : list.key === 'booked_no_collect'
                    ? bookedNoCollect.length
                    : didNotBook.length;
              return (
                <button
                  key={list.key}
                  type="button"
                  onClick={() => onListChange(list.key)}
                  className="flex w-full items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{list.label}</p>
                    <p className="mt-1 text-xs text-slate-600">{list.meaning}</p>
                  </div>
                  <p className="text-2xl font-bold tabular-nums text-slate-900">{count}</p>
                </button>
              );
            })}
          </div>
        ) : listKey === 'rarely_book' ? (
          <SimpleTable
            emptyTitle="Nobody in this list"
            emptyDetail="Everyone booked often enough in this date range."
            headers={['Name', 'Email', 'Days booked', 'How often']}
            rows={rarelyBook
              .filter((row) => matchesQuery(row, q))
              .map((row) => ({
                key: row.user_id,
                title: row.name,
                subtitle: row.email || 'No email',
                lines: [
                  `Booked on ${row.booked_days} of ${row.possible_days} working days`,
                  `Booking rate: ${row.booking_rate}% (under 50% = rarely books)`,
                ],
                cells: [
                  row.name,
                  row.email || '—',
                  `${row.booked_days} of ${row.possible_days} working days`,
                  `${row.booking_rate}% (under 50%)`,
                ],
              }))}
          />
        ) : listKey === 'booked_no_collect' ? (
          <SimpleTable
            emptyTitle="Nobody in this list"
            emptyDetail="Every booked meal was collected, or nobody booked."
            headers={['Name', 'Email', 'Meal date', 'Meal type', 'What happened']}
            rows={bookedNoCollect
              .filter((row) => matchesQuery(row, q))
              .map((row) => ({
                key: `${row.user_id}-${row.meal_date}-${row.choice}`,
                title: row.name,
                subtitle: row.email || 'No email',
                lines: [
                  `Meal date: ${row.meal_date || '—'} · ${formatChoice(row.choice)}`,
                  row.status === 'not_yet_served'
                    ? 'Status: not collected yet (service still open)'
                    : 'Status: booked but did not collect',
                ],
                cells: [
                  row.name,
                  row.email || '—',
                  row.meal_date || '—',
                  formatChoice(row.choice),
                  row.status === 'not_yet_served' ? 'Not collected yet' : 'Did not collect',
                ],
              }))}
          />
        ) : (
          <SimpleTable
            emptyTitle="Nobody in this list"
            emptyDetail="Everyone on this shift booked or skipped in this range."
            headers={['Name', 'Email', 'Employee code']}
            rows={didNotBook
              .filter((row) => matchesQuery(row, q))
              .map((row) => ({
                key: row.user_id,
                title: row.name,
                subtitle: row.email || 'No email',
                lines: [`Employee code: ${row.employee_code || '—'}`],
                cells: [row.name, row.email || '—', row.employee_code || '—'],
              }))}
          />
        )}
      </section>
    </div>
  );
}

export default function MealAttendanceReportPage() {
  const { profile, isImpersonating } = useAuth();
  const navigate = useNavigate();
  const today = getISTDateString();
  const [fromDate, setFromDate] = useState(() =>
    clampFromDate(addDaysIso(today, -13), today)
  );
  const [toDate, setToDate] = useState(() =>
    today < MEAL_CHECKIN_DATA_START ? MEAL_CHECKIN_DATA_START : today
  );
  const [mealShift, setMealShift] = useState('day');
  const [listKey, setListKey] = useState('summary');
  const [query, setQuery] = useState('');
  const [exportingShift, setExportingShift] = useState(null);
  const [exportError, setExportError] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const rangeLabel = useMemo(() => {
    if (fromDate === toDate) return formatDateLabel(fromDate);
    return `${formatDateLabel(fromDate)} → ${formatDateLabel(toDate)}`;
  }, [fromDate, toDate]);

  const activeReport = mealShift === 'night' ? preview?.night : preview?.day;
  const canDownload = Boolean(
    fromDate && toDate && fromDate <= toDate && !exportingShift && !previewLoading && activeReport
  );

  useEffect(() => {
    if (!fromDate || !toDate || fromDate > toDate) {
      setPreview(null);
      setPreviewError(fromDate > toDate ? 'From date must be on or before To date.' : '');
      return undefined;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    setExportError('');

    const timer = setTimeout(() => {
      api
        .mealAttendanceReportRange(fromDate, toDate)
        .then((payload) => {
          if (cancelled) return;
          setPreview(payload);
          if (payload?.from_clamped || fromDate < MEAL_CHECKIN_DATA_START) {
            setFromDate(payload.from_date || MEAL_CHECKIN_DATA_START);
          }
          const dayBooked = payload?.day?.summary?.booked ?? 0;
          const nightBooked = payload?.night?.summary?.booked ?? 0;
          if (dayBooked === 0 && nightBooked === 0) {
            setPreviewError(
              'No meal bookings in this date range. Choose dates when people booked meals.'
            );
          }
        })
        .catch((error) => {
          if (cancelled) return;
          setPreview(null);
          setPreviewError(
            error.message ||
              'Could not load data. Sign in as Admin and make sure the API is running.'
          );
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fromDate, toDate]);

  useEffect(() => {
    setListKey('summary');
    setQuery('');
  }, [mealShift, fromDate, toDate]);

  async function handleSignOut() {
    if (isImpersonating) {
      try {
        await exitImpersonation();
        navigate('/admin', { replace: true });
      } catch {
        await logoutWhileImpersonating().catch(() => {});
        navigate('/login', { replace: true });
      }
      return;
    }
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  async function handleExport(shift) {
    if (exportingShift || !preview) return;
    setExportingShift(shift);
    setExportError('');
    try {
      const report = shift === 'night' ? preview.night : preview.day;
      if (!report) throw new Error('Report was empty.');
      await downloadShiftAttendancePdf(report);
    } catch (error) {
      setExportError(error.message || 'Could not create the PDF.');
    } finally {
      setExportingShift(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f3f6f5] text-slate-900">
      <ImpersonationBanner />
      <header className="border-b border-emerald-950 bg-[#102f2d] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-3 py-3.5 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-400 text-sm font-black text-emerald-950">
              AW
            </span>
            <div>
              <p className="truncate text-sm font-bold">ApplyWizz Meal Service</p>
              <p className="mt-0.5 truncate text-xs text-emerald-100/75">
                Signed in as {profile?.preferred_name || profile?.full_name || 'Admin'}
                {profile?.role ? ` · ${profile.role}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="min-h-11 shrink-0 rounded-md border border-white/20 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            {isImpersonating ? 'Exit user view' : 'Sign out'}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
        <div className="flex flex-col items-stretch justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:gap-5 sm:pb-6">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Operations · Meal service
            </p>
            <h1 className="mt-2 text-2xl font-bold leading-tight text-slate-950 sm:text-[28px]">
              Meal attendance reports
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Choose dates → pick Day or Night → read the 6 simple numbers → open a people list if
              you need names → download PDF.
            </p>
            <p className="mt-2 max-w-2xl text-xs text-amber-800">
              Attendance (collected / did not collect) is counted only from{' '}
              <strong>{MEAL_CHECKIN_DATA_START}</strong> onward — that is when vendor QR check-in
              was live.
            </p>
          </div>
          <div className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm sm:w-80 sm:shrink-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Which dates?
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  From
                </span>
                <input
                  type="date"
                  value={fromDate}
                  min={MEAL_CHECKIN_DATA_START}
                  max={toDate || today}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (!next) return;
                    const clamped = clampFromDate(next, toDate || today);
                    setFromDate(clamped);
                    if (toDate && clamped > toDate) setToDate(clamped);
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  To
                </span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate < MEAL_CHECKIN_DATA_START ? MEAL_CHECKIN_DATA_START : fromDate}
                  max={today < MEAL_CHECKIN_DATA_START ? MEAL_CHECKIN_DATA_START : today}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (!next) return;
                    if (next < MEAL_CHECKIN_DATA_START) {
                      setToDate(MEAL_CHECKIN_DATA_START);
                      setFromDate(MEAL_CHECKIN_DATA_START);
                      return;
                    }
                    if (next > today) return;
                    setToDate(next);
                    if (fromDate && next < fromDate) setFromDate(clampFromDate(next, next));
                  }}
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900"
                />
              </label>
            </div>
            <p className="mt-2 text-xs font-medium text-slate-600">{rangeLabel}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Earliest From date: {MEAL_CHECKIN_DATA_START}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto border-b border-slate-200 sm:mt-5">
          <div className="flex min-w-max gap-1" role="tablist" aria-label="Shift">
            {[
              { key: 'day', label: 'Day shift' },
              { key: 'night', label: 'Night shift' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={mealShift === tab.key}
                onClick={() => setMealShift(tab.key)}
                className={`min-h-11 rounded-t-md px-4 text-sm font-bold transition-colors ${
                  mealShift === tab.key
                    ? 'bg-white text-emerald-900 shadow-[inset_0_-2px_0_0_#102f2d]'
                    : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {(exportError || previewError) && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {exportError || previewError}
          </p>
        )}

        <div className="mt-5">
          <ShiftPanel
            report={activeReport}
            loading={previewLoading}
            shift={mealShift}
            listKey={listKey}
            onListChange={setListKey}
            query={query}
            onQueryChange={setQuery}
            onDownload={() => handleExport(mealShift)}
            downloading={exportingShift === mealShift}
            canDownload={canDownload}
            rangeLabel={rangeLabel}
            skippedNoScanDates={preview?.skipped_no_scan_dates || []}
            includedScanDates={preview?.included_scan_dates || []}
          />
        </div>
      </main>
    </div>
  );
}
