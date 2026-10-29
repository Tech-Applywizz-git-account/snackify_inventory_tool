/**
 * Builds one shift-wise meal attendance PDF with plain-language labels.
 */

function formatChoice(choice) {
  if (!choice) return '—';
  return String(choice).replaceAll('_', ' ');
}

function drawMetricCards(pdf, { margin, pageWidth, y, summary }) {
  const metrics = [
    {
      label: 'Active people',
      hint: 'Can book',
      value: summary.total_active,
      fill: [241, 245, 249],
      text: [30, 41, 59],
    },
    {
      label: 'Booked a meal',
      hint: 'Veg/egg/non-veg',
      value: summary.booked,
      fill: [236, 253, 245],
      text: [6, 95, 70],
    },
    {
      label: 'Collected',
      hint: 'QR check-in',
      value: summary.served,
      fill: [219, 234, 254],
      text: [30, 64, 175],
    },
    {
      label: 'Did not collect',
      hint: 'Booked but absent',
      value: summary.balanced,
      fill: [255, 241, 242],
      text: [159, 18, 57],
    },
    {
      label: 'Did not book',
      hint: 'No booking',
      value: summary.not_booked,
      fill: [255, 251, 235],
      text: [146, 64, 14],
    },
    {
      label: 'Said skip',
      hint: 'Chose skip',
      value: summary.skipped,
      fill: [248, 250, 252],
      text: [71, 85, 105],
    },
  ];
  const gap = 3;
  const cardHeight = 22;
  const cardWidth = (pageWidth - margin * 2 - gap * (metrics.length - 1)) / metrics.length;
  metrics.forEach((metric, index) => {
    const x = margin + index * (cardWidth + gap);
    pdf.setFillColor(...metric.fill);
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(x, y, cardWidth, cardHeight, 1.5, 1.5, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(...metric.text);
    pdf.text(metric.label, x + 2.5, y + 6);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.text(metric.hint, x + 2.5, y + 10.5);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(String(metric.value ?? 0), x + 2.5, y + 18);
  });
  return y + cardHeight + 5;
}

export async function downloadShiftAttendancePdf(report) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const shiftLabel = report.shift === 'night' ? 'Night shift' : 'Day shift';
  const fromDate = report.from_date || report.lookback?.from || report.meal_date;
  const toDate = report.to_date || report.lookback?.to || report.meal_date;
  const rangeLabel = fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`;
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
  const summary = report.summary || {};

  function drawHeader() {
    pdf.setFillColor(20, 59, 67);
    pdf.rect(0, 0, pageWidth, 24, 'F');
    pdf.setFillColor(72, 161, 145);
    pdf.rect(0, 24, pageWidth, 1.2, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`Meal attendance · ${shiftLabel}`, margin, 10);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(223, 237, 235);
    pdf.text(`Dates ${rangeLabel}  |  Generated ${generatedAt} IST`, margin, 18);
  }

  drawHeader();

  let y = drawMetricCards(pdf, {
    margin,
    pageWidth,
    y: 30,
    summary,
  });

  const byChoice = report.by_choice || {};
  const skippedNoScan = report.skipped_no_scan_dates || [];
  const scanDates = report.included_scan_dates || [];
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(51, 65, 85);
  pdf.text(
    `On scanned days only: ${summary.booked || 0} booked → ${summary.served || 0} collected (${summary.attendance_percent ?? 0}% attendance) → ${summary.balanced || 0} booked but did not collect.`,
    margin,
    y
  );
  y += 4.5;
  pdf.setTextColor(100, 116, 139);
  pdf.text(
    `Meal types booked: Veg ${byChoice.veg || 0} · Non-veg ${byChoice.non_veg || 0} · Egg ${byChoice.egg || 0}`,
    margin,
    y
  );
  y += 4;
  if (skippedNoScan.length) {
    pdf.setTextColor(146, 64, 14);
    const skippedLine = `Skipped ${skippedNoScan.length} zero-scan day(s) (bookings existed, no QR scans): ${skippedNoScan.join(', ')}`;
    const wrapped = pdf.splitTextToSize(skippedLine, pageWidth - margin * 2);
    pdf.text(wrapped, margin, y);
    y += wrapped.length * 4 + 1;
  }
  if (scanDates.length) {
    pdf.setTextColor(71, 85, 105);
    const includedLine = `Included scanned days: ${scanDates.join(', ')}`;
    const wrapped = pdf.splitTextToSize(includedLine, pageWidth - margin * 2);
    pdf.text(wrapped, margin, y);
    y += wrapped.length * 4 + 1;
  }
  if (!summary.service_closed) {
    pdf.setTextColor(146, 64, 14);
    pdf.text(
      'Note: service still open — some “did not collect” rows may still check in later today.',
      margin,
      y
    );
    y += 4;
  }

  const rarelyBook = report.irregular_bookers || [];
  autoTable(pdf, {
    startY: y + 2,
    head: [
      [
        {
          content: `Rarely book — ${rarelyBook.length} people  |  Meaning: booked a meal on fewer than 50% of working days in this date range`,
          colSpan: 5,
        },
      ],
      ['#', 'Name', 'Email', 'Days booked', 'How often'],
    ],
    body:
      rarelyBook.length > 0
        ? rarelyBook.map((row, index) => [
            String(index + 1),
            row.name || 'Unknown',
            row.email || '—',
            `${row.booked_days} of ${row.possible_days} working days`,
            `${row.booking_rate}% (under 50%)`,
          ])
        : [['—', 'Nobody in this list', '—', '—', '—']],
    theme: 'grid',
    margin: { left: margin, right: margin, top: 28, bottom: 12 },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2.2,
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      textColor: [51, 65, 85],
      valign: 'middle',
    },
    headStyles: { fillColor: [20, 59, 67], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 249, 250] },
    didDrawPage: (data) => {
      drawHeader();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Page ${data.pageNumber}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
    },
  });

  const absent = report.booked_absent || [];
  autoTable(pdf, {
    startY: (pdf.lastAutoTable?.finalY || y) + 6,
    head: [
      [
        {
          content: `Booked, did not collect — ${absent.length} rows  |  Meaning: booked veg/egg/non-veg but never scanned QR`,
          colSpan: 5,
        },
      ],
      ['#', 'Name', 'Email', 'Meal date / type', 'What happened'],
    ],
    body:
      absent.length > 0
        ? absent.map((row, index) => [
            String(index + 1),
            row.name || 'Unknown',
            row.email || '—',
            `${row.meal_date || '—'} · ${formatChoice(row.choice)}`,
            row.status === 'not_yet_served' ? 'Not collected yet' : 'Did not collect',
          ])
        : [['—', 'Nobody in this list', '—', '—', '—']],
    theme: 'grid',
    margin: { left: margin, right: margin, top: 28, bottom: 12 },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2.2,
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      textColor: [51, 65, 85],
      valign: 'middle',
    },
    headStyles: { fillColor: [127, 29, 29], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [255, 246, 247] },
    didDrawPage: (data) => {
      drawHeader();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Page ${data.pageNumber}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
    },
  });

  const notBooked = report.not_booked || [];
  autoTable(pdf, {
    startY: (pdf.lastAutoTable?.finalY || y) + 6,
    head: [
      [
        {
          content: `Did not book — ${notBooked.length} people  |  Meaning: active on this shift, no booking row in this date range`,
          colSpan: 4,
        },
      ],
      ['#', 'Name', 'Email', 'Employee code'],
    ],
    body:
      notBooked.length > 0
        ? notBooked.map((row, index) => [
            String(index + 1),
            row.name || 'Unknown',
            row.email || '—',
            row.employee_code || '—',
          ])
        : [['—', 'Nobody in this list', '—', '—']],
    theme: 'grid',
    margin: { left: margin, right: margin, top: 28, bottom: 12 },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2.2,
      lineColor: [226, 232, 240],
      lineWidth: 0.15,
      textColor: [51, 65, 85],
      valign: 'middle',
    },
    headStyles: { fillColor: [120, 53, 15], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [255, 251, 235] },
    didDrawPage: (data) => {
      drawHeader();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Page ${data.pageNumber}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
    },
  });

  const fileRange = fromDate === toDate ? fromDate : `${fromDate}_to_${toDate}`;
  pdf.save(`meal-attendance-${report.shift}-${fileRange}.pdf`);
}

export async function downloadBothShiftAttendancePdfs(payload) {
  if (payload?.day) await downloadShiftAttendancePdf(payload.day);
  if (payload?.night) await downloadShiftAttendancePdf(payload.night);
}
