import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, CameraOff, MessageSquareText, RefreshCw, ScanLine, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { api } from '../../lib/api.js';
import { supabase } from '../../lib/supabase.js';
import VendorMealReport from './VendorMealReport.jsx';
import VendorReviewInbox from './VendorReviewInbox.jsx';

function getISTDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function stopMediaStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try {
      track.stop();
    } catch {}
  }
}

export default function VendorMealCheckinPage() {
  const { profile } = useAuth();
  const canViewReviews = ['leadership', 'finance', 'office_boy'].includes(profile?.role);
  const today = getISTDate();
  const [mealDate, setMealDate] = useState(getISTDate);
  const [mealShift, setMealShift] = useState('day');
  const [activeView, setActiveView] = useState('service');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [scanPending, setScanPending] = useState(false);
  const [scanMessage, setScanMessage] = useState(null);
  const [pageError, setPageError] = useState('');
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraSessionRef = useRef(0);
  const scanPendingRef = useRef(false);

  const loadSummary = useCallback(async () => {
    setPageError('');
    try {
      setSummary(await api.mealCheckinSummary(mealDate, mealShift));
    } catch (error) {
      setPageError(error.message || 'Could not load meal service counts.');
    } finally {
      setLoading(false);
    }
  }, [mealDate, mealShift]);

  useEffect(() => {
    loadSummary();
    const refreshTimer = window.setInterval(loadSummary, 15000);
    const dateTimer = window.setInterval(() => {
      const currentToday = getISTDate();
      setMealDate((selectedDate) => (selectedDate === today ? currentToday : selectedDate));
    }, 60000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(dateTimer);
    };
  }, [loadSummary, today]);

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1;
    const video = videoRef.current;
    const stream = video?.srcObject;
    try {
      controlsRef.current?.stop();
    } catch (error) {
      console.warn('[MealCheckin] Could not stop scanner controls cleanly.', error);
    }
    try {
      readerRef.current?.reset();
    } catch (error) {
      console.warn('[MealCheckin] Could not reset the QR reader cleanly.', error);
    }
    controlsRef.current = null;
    readerRef.current = null;
    stopMediaStream(stream);
    if (video) {
      try {
        video.pause();
      } catch {}
      video.srcObject = null;
    }
    setCameraOpen(false);
  }, []);

  useEffect(
    () => () => {
      cameraSessionRef.current += 1;
      const video = videoRef.current;
      const stream = video?.srcObject;
      controlsRef.current?.stop();
      readerRef.current?.reset();
      stopMediaStream(stream);
      if (video) video.srcObject = null;
    },
    []
  );

  const submitToken = useCallback(
    async (rawToken) => {
      const token = String(rawToken || '').trim();
      if (!token || scanPendingRef.current) return;
      scanPendingRef.current = true;
      setScanPending(true);
      setScanMessage(null);
      try {
        const result = await api.mealCheckinScan({ token, date: mealDate });
        const alreadyServed = result.already_served;
        setScanMessage({
          kind: alreadyServed ? 'warning' : 'success',
          title: alreadyServed ? 'Already served' : 'Meal checked in',
          detail: `${result.employee?.name || 'Employee'}${result.employee?.employee_code ? ` · ${result.employee.employee_code}` : ''} · ${String(result.employee?.choice || '').replace('_', ' ')} · ${result.employee?.shift === 'night' ? 'Night shift' : 'Day shift'}`,
        });
        setManualToken('');
        await loadSummary();
      } catch (error) {
        setScanMessage({ kind: 'error', title: 'Check-in not completed', detail: error.message });
      } finally {
        scanPendingRef.current = false;
        setScanPending(false);
      }
    },
    [loadSummary, mealDate]
  );

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanMessage({
        kind: 'error',
        title: 'Camera unavailable',
        detail: 'Use manual token entry or open this page in a secure browser context.',
      });
      return;
    }
    const video = videoRef.current;
    if (!video) {
      setScanMessage({
        kind: 'error',
        title: 'Scanner is not ready',
        detail: 'Refresh this page and try starting the camera again.',
      });
      return;
    }
    const cameraSession = cameraSessionRef.current + 1;
    cameraSessionRef.current = cameraSession;
    try {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      setCameraOpen(true);
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        video,
        (result, _error, scanControls) => {
          if (scanControls) controlsRef.current = scanControls;
          if (result && !scanPendingRef.current) {
            let decodedToken;
            try {
              decodedToken = result.getText();
            } catch (error) {
              setScanMessage({
                kind: 'error',
                title: 'QR could not be read',
                detail: error.message || 'Try scanning the code again.',
              });
              return;
            }
            stopCamera();
            void submitToken(decodedToken);
          }
        }
      );
      if (cameraSessionRef.current !== cameraSession) {
        const stream = videoRef.current?.srcObject;
        try {
          controls.stop();
        } catch {}
        stopMediaStream(stream);
        if (readerRef.current === reader) readerRef.current = null;
        return;
      }
      controlsRef.current = controls;
    } catch (error) {
      if (cameraSessionRef.current !== cameraSession) return;
      stopCamera();
      setScanMessage({
        kind: 'error',
        title: 'Camera could not start',
        detail: error.message || 'Check camera permission and try again.',
      });
    }
  }

  const formattedDate = new Date(`${mealDate}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const servedToday = summary?.daily_servings?.served ?? summary?.served ?? 0;
  const bookedToday = summary?.booked ?? 0;
  const attendancePercent = Math.min(summary?.attendance_percent || 0, 100);

  function handleViewTabsKeyDown(event) {
    if (!canViewReviews) return;
    let nextView = null;
    if (event.key === 'ArrowRight') nextView = activeView === 'service' ? 'feedback' : 'service';
    if (event.key === 'ArrowLeft') nextView = activeView === 'feedback' ? 'service' : 'feedback';
    if (event.key === 'Home') nextView = 'service';
    if (event.key === 'End') nextView = 'feedback';
    if (!nextView) return;

    event.preventDefault();
    if (nextView === 'feedback' && cameraOpen) stopCamera();
    setActiveView(nextView);
    document.getElementById(`vendor-${nextView}-tab`)?.focus();
  }

  return (
    <div className="min-h-screen bg-[#f3f6f5] text-slate-900">
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
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="min-h-11 shrink-0 rounded-md border border-white/20 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Sign out
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
              Meal token check-in
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Verify each collection and keep today’s service moving.
            </p>
          </div>
          <div className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm sm:w-64 sm:shrink-0">
            <label
              htmlFor="vendor-service-date"
              className="text-[11px] font-bold uppercase tracking-wide text-slate-500"
            >
              Service date · View past reports
            </label>
            <input
              id="vendor-service-date"
              type="date"
              value={mealDate}
              max={today}
              onChange={(event) => {
                const selectedDate = event.target.value;
                if (!selectedDate || selectedDate > today) return;
                if (cameraOpen) stopCamera();
                setSummary(null);
                setLoading(true);
                setScanMessage(null);
                setMealDate(selectedDate);
              }}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900"
            />
            <p className="mt-1 text-xs font-medium text-slate-600">{formattedDate}</p>
            <span
              className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${summary?.service_closed ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-800'}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${summary?.service_closed ? 'bg-slate-500' : 'bg-emerald-600'}`}
              />
              {loading
                ? 'Loading service'
                : summary?.service_closed
                  ? 'Service closed'
                  : 'Service open'}
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto border-b border-slate-200 sm:mt-5">
          <div
            className="flex min-w-max gap-1"
            role="tablist"
            aria-label="Vendor meal service views"
            onKeyDown={handleViewTabsKeyDown}
          >
            <button
              id="vendor-service-tab"
              type="button"
              role="tab"
              aria-selected={activeView === 'service'}
              tabIndex={activeView === 'service' ? 0 : -1}
              aria-controls="vendor-service-panel"
              onClick={() => setActiveView('service')}
              className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-bold transition-colors sm:px-4 ${activeView === 'service' ? 'border-emerald-700 text-emerald-900' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}
            >
              <ScanLine size={16} /> Meal service
            </button>
            {canViewReviews && (
              <button
                id="vendor-feedback-tab"
                type="button"
                role="tab"
                aria-selected={activeView === 'feedback'}
                tabIndex={activeView === 'feedback' ? 0 : -1}
                aria-controls="vendor-feedback-panel"
                onClick={() => {
                  if (cameraOpen) stopCamera();
                  setActiveView('feedback');
                }}
                className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-bold transition-colors sm:px-4 ${activeView === 'feedback' ? 'border-emerald-700 text-emerald-900' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}
              >
                <MessageSquareText size={16} /> Employee reviews
              </button>
            )}
          </div>
        </div>

        {activeView === 'service' ? (
          <div id="vendor-service-panel" role="tabpanel" aria-labelledby="vendor-service-tab">
            <fieldset className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5">
              <legend className="sr-only">Filter service report by employee shift</legend>
              <span className="mr-1 text-sm font-semibold text-slate-600">Employee shift</span>
              {[
                ['day', 'Day shift'],
                ['night', 'Night shift'],
              ].map(([shift, label]) => (
                <button
                  key={shift}
                  type="button"
                  aria-pressed={mealShift === shift}
                  onClick={() => {
                    if (cameraOpen) stopCamera();
                    setSummary(null);
                    setLoading(true);
                    setMealShift(shift);
                  }}
                  className={`min-h-11 rounded-md border px-4 text-sm font-bold transition-colors ${
                    mealShift === shift
                      ? 'border-emerald-800 bg-emerald-800 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="w-full text-xs text-slate-500 sm:w-auto">
                Employees are grouped using their saved work-shift preference.
              </span>
            </fieldset>
            <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
                        Collection desk
                      </p>
                      <h2 className="mt-1 text-base font-bold text-slate-950">Scan meal token</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Verify a {mealShift} shift booking before serving the meal.
                      </p>
                    </div>
                    {cameraOpen ? (
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <CameraOff size={16} /> Stop camera
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={mealDate !== today}
                        onClick={startCamera}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-800 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        <Camera size={16} /> Scan QR
                      </button>
                    )}
                  </div>
                  {mealDate !== today && (
                    <p className="mt-3 text-sm text-amber-800">
                      Scanning is available only for today’s service.
                    </p>
                  )}
                </div>
                <div className="p-5 sm:p-6">
                  <div
                    className={`relative overflow-hidden rounded-lg bg-slate-950 ${cameraOpen ? '' : 'hidden'}`}
                  >
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="aspect-video w-full object-cover"
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 to-transparent px-4 pb-4 pt-10 text-sm font-semibold text-white">
                      Center the meal QR in the camera view
                    </div>
                  </div>
                  {!cameraOpen && (
                    <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-emerald-200 bg-emerald-50/60 px-5 py-6 text-center">
                      <div>
                        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-white text-emerald-800 shadow-sm ring-1 ring-emerald-100">
                          <ScanLine size={20} />
                        </span>
                        <p className="mt-3 text-sm font-bold text-slate-800">
                          Ready for the next employee
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          Start the camera or enter the QR code manually.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:px-6">
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitToken(manualToken);
                    }}
                  >
                    <input
                      value={manualToken}
                      onChange={(event) => setManualToken(event.target.value)}
                      placeholder="Paste meal QR code"
                      aria-label="Meal QR code"
                      className="h-11 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                    />
                    <button
                      type="submit"
                      disabled={scanPending || mealDate !== today}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-slate-900 px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:bg-slate-400"
                    >
                      <ScanLine size={16} /> {scanPending ? 'Checking…' : 'Check in'}
                    </button>
                  </form>
                  {scanMessage && (
                    <div
                      role="status"
                      className={`mt-3 rounded-md border p-3 ${scanMessage.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : scanMessage.kind === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}
                    >
                      <p className="text-sm font-semibold">{scanMessage.title}</p>
                      <p className="mt-1 text-sm">{scanMessage.detail}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4 sm:px-6">
                  <Users size={17} className="text-emerald-800" />
                  <h2 className="font-bold text-slate-950">
                    {mealShift === 'night' ? 'Night shift' : 'Day shift'} service overview
                  </h2>
                  <button
                    type="button"
                    onClick={loadSummary}
                    title="Refresh counts"
                    className="ml-auto grid min-h-11 min-w-11 place-items-center rounded-md border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>
                <div className="p-5 sm:p-6">
                  <div className="rounded-lg bg-[#102f2d] p-4 text-white">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100/80">
                          Meals served
                        </p>
                        <p className="mt-1 text-4xl font-bold tabular-nums">
                          {loading || pageError ? '—' : servedToday}
                        </p>
                      </div>
                      <p className="pb-1 text-sm font-medium text-emerald-50">
                        of {loading || pageError ? '—' : bookedToday} booked
                      </p>
                    </div>
                    <div
                      className="mt-4 h-2 overflow-hidden rounded-full bg-white/20"
                      role="progressbar"
                      aria-label="Meal attendance"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={attendancePercent}
                    >
                      <div
                        className="h-full rounded-full bg-emerald-300 transition-[width] duration-300"
                        style={{ width: `${attendancePercent}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-emerald-50/85">
                      <span className="min-w-0">
                        Attendance{' '}
                        <strong className="text-white">
                          {loading || pageError ? '—' : `${summary?.attendance_percent ?? 0}%`}
                        </strong>
                      </span>
                      <span className="text-right">
                        Closes{' '}
                        {mealShift === 'night'
                          ? '12:00 AM (next day)'
                          : `${summary?.service_cutoff_ist || '14:00'} IST`}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-medium text-slate-500">Not yet served</p>
                      <p className="mt-1 text-xl font-bold tabular-nums text-amber-700">
                        {loading || pageError ? '—' : (summary?.not_yet_served ?? 0)}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-medium text-slate-500">No-shows</p>
                      <p className="mt-1 text-xl font-bold tabular-nums text-rose-700">
                        {loading || pageError ? '—' : (summary?.no_show ?? 0)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    {Object.entries(summary?.by_choice || {}).map(([choice, count]) => (
                      <span
                        key={choice}
                        className="rounded bg-white px-2.5 py-1.5 text-slate-700 ring-1 ring-slate-200"
                      >
                        {choice.replace('_', ' ')} <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    <p className="text-xs font-semibold text-slate-700">Daily servings saved</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {loading || pageError
                        ? '—'
                        : `${summary?.daily_servings?.served ?? 0} total · ${Object.entries(
                            summary?.daily_servings?.by_choice || {}
                          )
                            .map(([choice, count]) => `${choice.replace('_', ' ')} ${count}`)
                            .join(' · ')}`}
                    </p>
                    {summary?.daily_servings?.last_served_at && (
                      <p className="mt-1 text-xs text-slate-500">
                        Last served at{' '}
                        {new Date(summary.daily_servings.last_served_at).toLocaleTimeString(
                          'en-IN',
                          {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Kolkata',
                          }
                        )}{' '}
                        IST
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <VendorMealReport
              bookings={summary?.bookings || []}
              loading={loading}
              error={pageError}
              serviceClosed={summary?.service_closed}
              mealDate={mealDate}
              serviceSummary={summary}
            />
          </div>
        ) : canViewReviews ? (
          <div id="vendor-feedback-panel" role="tabpanel" aria-labelledby="vendor-feedback-tab">
            <VendorReviewInbox mealDate={mealDate} />
          </div>
        ) : null}
      </main>
    </div>
  );
}
