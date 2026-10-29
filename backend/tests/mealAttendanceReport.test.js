import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDaysIso,
  buildMealAttendanceReports,
  buildShiftAttendanceReport,
  clampAttendanceFromDate,
  findDatesSkippedForNoScan,
  findIrregularBookers,
  listWeekdays,
  MEAL_CHECKIN_DATA_START,
} from '../src/lib/mealAttendanceReport.js';

describe('mealAttendanceReport helpers', () => {
  it('clamps attendance from-date to check-in go-live', () => {
    assert.equal(MEAL_CHECKIN_DATA_START, '2026-10-10');
    assert.equal(clampAttendanceFromDate('2026-10-01', '2026-10-20'), '2026-10-10');
    assert.equal(clampAttendanceFromDate('2026-10-12', '2026-10-20'), '2026-10-12');
    assert.equal(clampAttendanceFromDate('2026-10-01', '2026-10-05'), null);
  });

  it('skips meal dates that have bookings but zero QR scans', () => {
    const skipped = findDatesSkippedForNoScan({
      fromDate: '2026-10-10',
      toDate: '2026-10-14',
      bookings: [
        { id: 'a', choice: 'veg', meal_date: '2026-10-10' },
        { id: 'b', choice: 'veg', meal_date: '2026-10-13' },
        { id: 'c', choice: 'egg', meal_date: '2026-10-13' },
      ],
      checkins: [{ meal_booking_id: 'a', meal_date: '2026-10-10', checked_in_at: 'x' }],
    });
    assert.deepEqual(skipped, ['2026-10-13']);

    const reports = buildMealAttendanceReports({
      fromDate: '2026-10-10',
      toDate: '2026-10-14',
      profiles: [
        { id: 'u1', full_name: 'One', role: 'staff', active: true },
        { id: 'u2', full_name: 'Two', role: 'staff', active: true },
      ],
      preferences: [
        { user_id: 'u1', shift: 'day' },
        { user_id: 'u2', shift: 'day' },
      ],
      rangeBookings: [
        { id: 'a', user_id: 'u1', choice: 'veg', meal_date: '2026-10-10' },
        { id: 'b', user_id: 'u2', choice: 'veg', meal_date: '2026-10-13' },
      ],
      rangeCheckins: [
        { meal_booking_id: 'a', meal_date: '2026-10-10', checked_in_at: '2026-10-10T04:00:00Z' },
      ],
      dayServiceClosed: true,
      nightServiceClosed: true,
    });

    assert.deepEqual(reports.skipped_no_scan_dates, ['2026-10-13']);
    assert.equal(reports.day.summary.booked, 1);
    assert.equal(reports.day.summary.served, 1);
    assert.equal(reports.day.summary.balanced, 0);
    assert.equal(reports.day.summary.days_skipped_no_scan, 1);
  });

  it('lists weekdays only across a range', () => {
    // 2026-03-02 Mon … 2026-03-08 Sun
    assert.deepEqual(listWeekdays('2026-03-02', '2026-03-08'), [
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
    ]);
    assert.equal(addDaysIso('2026-03-06', 3), '2026-03-09');
  });

  it('aggregates a from→to range into shift summaries', () => {
    const profiles = [
      { id: 'd1', full_name: 'Day One', role: 'staff', active: true },
      { id: 'd2', full_name: 'Day Two', role: 'staff', active: true },
    ];
    const preferences = [
      { user_id: 'd1', shift: 'day' },
      { user_id: 'd2', shift: 'day' },
    ];
    const rangeBookings = [
      { id: 'b1', user_id: 'd1', choice: 'veg', meal_date: '2026-03-04' },
      { id: 'b2', user_id: 'd1', choice: 'veg', meal_date: '2026-03-05' },
      { id: 'b3', user_id: 'd2', choice: 'egg', meal_date: '2026-03-05' },
    ];
    const rangeCheckins = [
      { meal_booking_id: 'b1', meal_date: '2026-03-04', checked_in_at: '2026-03-04T04:00:00Z' },
      { meal_booking_id: 'b2', meal_date: '2026-03-05', checked_in_at: '2026-03-05T04:00:00Z' },
    ];
    const reports = buildMealAttendanceReports({
      fromDate: '2026-03-04',
      toDate: '2026-03-05',
      profiles,
      preferences,
      rangeBookings,
      rangeCheckins,
      dayServiceClosed: true,
      nightServiceClosed: true,
    });
    assert.equal(reports.from_date, '2026-03-04');
    assert.equal(reports.to_date, '2026-03-05');
    assert.equal(reports.day.summary.booked, 3);
    assert.equal(reports.day.summary.served, 2);
    assert.equal(reports.day.summary.balanced, 1);
    assert.equal(reports.day.booked_absent[0].meal_date, '2026-03-05');
  });

  it('builds day and night summaries with balanced = booked − served', () => {
    const profiles = [
      { id: 'd1', full_name: 'Day One', role: 'staff', active: true, email: 'd1@x.ai' },
      { id: 'd2', full_name: 'Day Two', role: 'staff', active: true, email: 'd2@x.ai' },
      { id: 'd3', full_name: 'Day Three', role: 'staff', active: true, email: 'd3@x.ai' },
      { id: 'n1', full_name: 'Night One', role: 'staff', active: true, email: 'n1@x.ai' },
      { id: 'v1', full_name: 'Vendor', role: 'vendor', active: true, email: 'v@x.ai' },
    ];
    const preferences = [
      { user_id: 'd1', shift: 'day' },
      { user_id: 'd2', shift: 'day' },
      { user_id: 'd3', shift: 'day' },
      { user_id: 'n1', shift: 'night' },
    ];
    const dayBookings = [
      { id: 'b1', user_id: 'd1', choice: 'veg', meal_date: '2026-03-05' },
      { id: 'b2', user_id: 'd2', choice: 'egg', meal_date: '2026-03-05' },
      { id: 'b3', user_id: 'd3', choice: 'skip', meal_date: '2026-03-05' },
      { id: 'b4', user_id: 'n1', choice: 'non_veg', meal_date: '2026-03-05' },
    ];
    const dayCheckins = [
      { meal_booking_id: 'b1', meal_date: '2026-03-05', checked_in_at: '2026-03-05T04:00:00Z' },
    ];

    const reports = buildMealAttendanceReports({
      mealDate: '2026-03-05',
      lookbackDays: 14,
      profiles,
      preferences,
      dayBookings,
      dayCheckins,
      historyBookings: dayBookings,
      dayServiceClosed: true,
      nightServiceClosed: true,
    });

    assert.equal(reports.day.summary.total_active, 3);
    assert.equal(reports.day.summary.booked, 2);
    assert.equal(reports.day.summary.served, 1);
    assert.equal(reports.day.summary.balanced, 1);
    assert.equal(reports.day.summary.skipped, 1);
    assert.equal(reports.day.summary.not_booked, 0);
    assert.equal(reports.day.booked_absent.length, 1);
    assert.equal(reports.day.booked_absent[0].user_id, 'd2');
    assert.equal(reports.day.booked_absent[0].status, 'no_show');

    assert.equal(reports.night.summary.total_active, 1);
    assert.equal(reports.night.summary.booked, 1);
    assert.equal(reports.night.summary.served, 0);
    assert.equal(reports.night.summary.balanced, 1);
  });

  it('flags irregular bookers under 50% weekday food bookings', () => {
    const mealDate = '2026-03-06'; // Fri
    const profiles = [
      { id: 'a', full_name: 'Always', role: 'staff', active: true },
      { id: 'r', full_name: 'Rare', role: 'staff', active: true },
    ];
    const preferences = [
      { user_id: 'a', shift: 'day' },
      { user_id: 'r', shift: 'day' },
    ];
    // 14-day lookback ending Fri 6 Mar → weekdays from 21 Feb
    const historyBookings = [
      { user_id: 'a', choice: 'veg', meal_date: '2026-02-23' },
      { user_id: 'a', choice: 'veg', meal_date: '2026-02-24' },
      { user_id: 'a', choice: 'veg', meal_date: '2026-02-25' },
      { user_id: 'a', choice: 'veg', meal_date: '2026-02-26' },
      { user_id: 'a', choice: 'veg', meal_date: '2026-02-27' },
      { user_id: 'a', choice: 'veg', meal_date: '2026-03-02' },
      { user_id: 'a', choice: 'veg', meal_date: '2026-03-03' },
      { user_id: 'a', choice: 'veg', meal_date: '2026-03-04' },
      { user_id: 'a', choice: 'veg', meal_date: '2026-03-05' },
      { user_id: 'a', choice: 'veg', meal_date: '2026-03-06' },
      { user_id: 'r', choice: 'veg', meal_date: '2026-03-06' },
    ];

    const irregular = findIrregularBookers({
      profiles,
      preferences,
      bookings: historyBookings,
      shift: 'day',
      mealDate,
      lookbackDays: 14,
    });

    assert.equal(irregular.some((row) => row.user_id === 'r'), true);
    assert.equal(irregular.some((row) => row.user_id === 'a'), false);
  });

  it('keeps not-yet-served status when service is still open', () => {
    const report = buildShiftAttendanceReport({
      shift: 'day',
      mealDate: '2026-03-05',
      profiles: [
        { id: 'd1', full_name: 'Day', role: 'staff', active: true },
        { id: 'd2', full_name: 'Other', role: 'staff', active: true },
      ],
      preferences: [
        { user_id: 'd1', shift: 'day' },
        { user_id: 'd2', shift: 'day' },
      ],
      // Need at least one scan that day so the date is not skipped as "zero scan".
      dayBookings: [
        { id: 'b0', user_id: 'd2', choice: 'veg', meal_date: '2026-03-05' },
        { id: 'b1', user_id: 'd1', choice: 'veg', meal_date: '2026-03-05' },
      ],
      dayCheckins: [
        { meal_booking_id: 'b0', meal_date: '2026-03-05', checked_in_at: '2026-03-05T04:00:00Z' },
      ],
      historyBookings: [],
      serviceClosed: false,
    });
    assert.equal(report.summary.balanced, 1);
    assert.equal(report.booked_absent[0].user_id, 'd1');
    assert.equal(report.booked_absent[0].status, 'not_yet_served');
  });
});
