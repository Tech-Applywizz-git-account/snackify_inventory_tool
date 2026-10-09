import { CheckCircle2, Clock3, Download, Search, UserRound, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

const FILTERS = [
  { key: 'all', label: 'All employees' },
  { key: 'not_yet_served', label: 'Not served' },
  { key: 'served', label: 'Served' },
  { key: 'no_show', label: 'No-shows' },
  { key: 'not_booked', label: 'Not booked' },
];

function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

async function downloadReport({ rows, mealDate, serviceSummary, filterLabel, searchTerm }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const generatedAt = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  function drawHeader() {
    pdf.setFillColor(20, 59, 67);
    pdf.rect(0, 0, pageWidth, 25, 'F');
    pdf.setFillColor(72, 161, 145);
    pdf.rect(0, 25, pageWidth, 1.3, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.setTextColor(255, 255, 255);
    pdf.text('Meal Service Report', margin, 11);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(223, 237, 235);
    pdf.text(
      `${mealDate}  |  ${filterLabel}${searchTerm ? `  |  Search: ${searchTerm}` : ''}`,
      margin,
      19
    );
  }

  drawHeader();

  const metrics = [
    {
      label: 'Total booked',
      value: serviceSummary?.booked ?? rows.length,
      fill: [241, 245, 249],
      text: [30, 41, 59],
    },
    {
      label: 'Served',
      value: serviceSummary?.daily_servings?.served ?? serviceSummary?.served ?? 0,
      fill: [236, 253, 245],
      text: [6, 95, 70],
    },
    {
      label: 'Not yet served',
      value: serviceSummary?.not_yet_served ?? 0,
      fill: [255, 251, 235],
      text: [146, 64, 14],
    },
    {
      label: 'No-shows',
      value: serviceSummary?.no_show ?? 0,
      fill: [255, 241, 242],
      text: [159, 18, 57],
    },
  ];
  const gap = 4;
  const cardY = 31;
  const cardHeight = 21;
  const cardWidth = (pageWidth - margin * 2 - gap * (metrics.length - 1)) / metrics.length;
  metrics.forEach((metric, index) => {
    const x = margin + index * (cardWidth + gap);
    pdf.setFillColor(...metric.fill);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(x, cardY, cardWidth, cardHeight, 2, 2, 'FD');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...metric.text);
    pdf.text(metric.label, x + 4, cardY + 7);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(String(metric.value), x + 4, cardY + 16);
  });

  const byChoice = serviceSummary?.by_choice || {};
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(
    `Meal choice: Veg ${byChoice.veg || 0}   Non-veg ${byChoice.non_veg || 0}   Egg ${byChoice.egg || 0}   |   Attendance ${serviceSummary?.attendance_percent ?? 0}%   |   Generated ${generatedAt} IST`,
    margin,
    59
  );

  autoTable(pdf, {
    startY: 64,
    head: [
      [
        'S. No.',
        'Employee',
        'Employee code',
        'Meal choice',
        'Status',
        'Served at (IST)',
        'Checked in by',
      ],
    ],
    body: rows.map((row, index) => [
      String(index + 1),
      row.employee_name || 'Unknown',
      row.employee_code || '—',
      row.choice ? String(row.choice).replace('_', ' ') : 'Not booked',
      row.status === 'not_yet_served'
        ? 'Not yet served'
        : row.status === 'no_show'
          ? 'No-show'
          : row.status === 'not_booked'
            ? 'Not booked'
            : 'Served',
      formatTime(row.checked_in_at),
      row.checked_in_by || '—',
    ]),
    theme: 'grid',
    margin: { left: margin, right: margin, top: 29, bottom: 13 },
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.7,
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      textColor: [51, 65, 85],
      valign: 'middle',
    },
    headStyles: { fillColor: [20, 59, 67], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 249, 250] },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      1: { cellWidth: 45 },
      2: { cellWidth: 32 },
      3: { cellWidth: 30 },
      4: { cellWidth: 34 },
      5: { cellWidth: 36 },
    },
    didDrawPage: (data) => {
      drawHeader();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Page ${data.pageNumber}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
    },
  });

  const filterSlug = filterLabel.toLowerCase().replaceAll(' ', '-');
  pdf.save(`meal-service-report-${mealDate}-${filterSlug}.pdf`);
}

function StatusBadge({ status }) {
  const isServed = status === 'served';
  const isNoShow = status === 'no_show';
  const isNotBooked = status === 'not_booked';
  const Icon = isServed ? CheckCircle2 : isNotBooked ? UserRound : Clock3;
  const label = isServed
    ? 'Served'
    : isNoShow
      ? 'No-show'
      : isNotBooked
        ? 'Not booked'
        : 'Not served';
  const colors = isServed
    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
    : isNoShow
      ? 'bg-rose-50 text-rose-800 ring-rose-200'
      : isNotBooked
        ? 'bg-slate-100 text-slate-700 ring-slate-300'
        : 'bg-amber-50 text-amber-800 ring-amber-200';

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 text-xs font-semibold ring-1 ${colors}`}
    >
      <Icon size={13} />
      {label}
    </span>
  );
}

export default function VendorMealReport({
  bookings = [],
  loading,
  error,
  serviceClosed,
  mealDate,
  serviceSummary,
}) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const counts = useMemo(() => {
    const result = { all: bookings.length, not_yet_served: 0, served: 0, no_show: 0, not_booked: 0 };
    for (const booking of bookings) {
      if (Object.hasOwn(result, booking.status)) result[booking.status] += 1;
    }
    return result;
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return bookings.filter((booking) => {
      const matchesFilter = activeFilter === 'all' || booking.status === activeFilter;
      const matchesQuery =
        !normalizedQuery ||
        `${booking.employee_name} ${booking.employee_code}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [activeFilter, bookings, query]);

  async function handleExport() {
    setExporting(true);
    setExportError('');
    try {
      await downloadReport({
        rows: filteredBookings,
        mealDate: mealDate || serviceSummary?.meal_date || new Date().toISOString().slice(0, 10),
        serviceSummary,
        filterLabel: FILTERS.find((filter) => filter.key === activeFilter)?.label || 'All bookings',
        searchTerm: query.trim(),
      });
    } catch (downloadError) {
      setExportError(downloadError.message || 'Could not create the PDF report.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-50 text-emerald-800">
            <Users size={17} />
          </span>
          <div>
            <h2 className="font-semibold text-slate-950">Service report</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {serviceClosed
                ? 'Service closed. Unserved bookings are marked as no-shows.'
                : 'Live booking and meal collection status.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={loading || exporting || Boolean(error) || filteredBookings.length === 0}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-800 px-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Download size={15} className={exporting ? 'animate-bounce' : ''} />
          {exporting ? 'Creating PDF…' : 'Download PDF'}
        </button>
      </header>

      {exportError && (
        <p
          role="alert"
          className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-800"
        >
          {exportError}
        </p>
      )}

      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <nav className="flex max-w-full gap-1 overflow-x-auto" aria-label="Filter service report">
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              aria-pressed={activeFilter === filter.key}
              onClick={() => setActiveFilter(filter.key)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-bold transition-colors ${activeFilter === filter.key ? 'bg-emerald-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {filter.label}
              <span className={activeFilter === filter.key ? 'text-slate-300' : 'text-slate-400'}>
                {counts[filter.key]}
              </span>
            </button>
          ))}
        </nav>
        <label className="relative block w-full lg:max-w-xs">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find employee or code"
            aria-label="Search service report"
            className="min-h-11 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="px-5 py-6 text-sm text-rose-700">
          {error}
        </p>
      ) : loading ? (
        <p className="px-5 py-6 text-sm text-slate-500">Loading service report…</p>
      ) : filteredBookings.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm font-semibold text-slate-800">
            {bookings.length === 0 ? 'No employees in this shift roster.' : 'No employees match this view.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {bookings.length === 0
              ? 'Active employees for the selected shift will appear here.'
              : 'Try another status filter or search term.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3 p-3 md:hidden">
            {filteredBookings.map((booking, index) => (
              <article
                key={booking.row_id || booking.booking_id}
                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-slate-900">
                      {booking.employee_name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {booking.employee_code || 'No employee code'} · #{index + 1}
                    </p>
                  </div>
                  <StatusBadge status={booking.status} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-xs">
                  <div>
                    <dt className="text-slate-500">Meal</dt>
                    <dd className="mt-0.5 font-medium capitalize text-slate-800">
                      {booking.choice ? booking.choice.replace('_', ' ') : 'Not booked'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Served at</dt>
                    <dd className="mt-0.5 font-medium text-slate-800">
                      {formatTime(booking.checked_in_at)}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Checked in by</dt>
                    <dd className="mt-0.5 break-words font-medium text-slate-800">
                      {booking.checked_in_by || '—'}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="w-16 px-4 py-3 font-semibold sm:px-5">S. No.</th>
                <th className="px-4 py-3 font-semibold sm:px-5">Employee</th>
                <th className="px-4 py-3 font-semibold">Meal</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Served at</th>
                <th className="px-4 py-3 font-semibold">Checked in by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBookings.map((booking, index) => (
                <tr key={booking.row_id || booking.booking_id} className="transition-colors hover:bg-emerald-50/40">
                  <td className="px-4 py-3 tabular-nums text-slate-500 sm:px-5">{index + 1}</td>
                  <td className="whitespace-nowrap px-4 py-3 sm:px-5">
                    <p className="font-semibold text-slate-900">{booking.employee_name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {booking.employee_code || 'No employee code'}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-700">
                      {booking.choice ? booking.choice.replace('_', ' ') : 'Not booked'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={booking.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {formatTime(booking.checked_in_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {booking.checked_in_by || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      {!loading && !error && filteredBookings.length > 0 && (
        <footer className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
          Showing {filteredBookings.length} of {bookings.length} employees
        </footer>
      )}
    </section>
  );
}
