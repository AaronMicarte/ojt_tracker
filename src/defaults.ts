import { AppData, Settings } from './types';

export const STORAGE_KEY = 'ojt_tracker_data_v1';

/**
 * Philippine national regular holidays + special non-working days.
 * Sources:
 * - Proclamation No. 1006 (2026 fixed holidays)
 * - Proclamation No. 1189 & No. 1264 (2026 Islamic holidays)
 * - Proclamation No. 1427 (2027 fixed holidays)
 *
 * Note: EDSA People Power Anniversary (Feb 25) is a Special *Working* Day
 * in both 2026 and 2027, so it is intentionally excluded.
 */
export const PHILIPPINE_HOLIDAYS: string[] = [
    // 2026
    '2026-01-01', // New Year's Day (Regular)
    '2026-02-17', // Chinese New Year (Special Non-Working)
    '2026-03-20', // Eid'l Fitr (Regular - Proclamation No. 1189)
    '2026-04-02', // Maundy Thursday (Regular)
    '2026-04-03', // Good Friday (Regular)
    '2026-04-04', // Black Saturday (Special Non-Working)
    '2026-04-09', // Araw ng Kagitingan (Regular)
    '2026-05-01', // Labor Day (Regular)
    '2026-05-27', // Eid'l Adha (Regular - Proclamation No. 1264)
    '2026-06-12', // Independence Day (Regular)
    '2026-08-21', // Ninoy Aquino Day (Special Non-Working)
    '2026-08-31', // National Heroes Day (Regular)
    '2026-11-01', // All Saints' Day (Special Non-Working)
    '2026-11-02', // All Souls' Day (Special Non-Working)
    '2026-11-30', // Bonifacio Day (Regular)
    '2026-12-08', // Immaculate Conception (Special Non-Working)
    '2026-12-24', // Christmas Eve (Special Non-Working)
    '2026-12-25', // Christmas Day (Regular)
    '2026-12-30', // Rizal Day (Regular)
    '2026-12-31', // Last Day of the Year (Special Non-Working)

    // 2027 (Q1 only — up to March 31)
    '2027-01-01', // New Year's Day (Regular)
    '2027-02-06', // Chinese New Year (Special Non-Working)
    '2027-03-10', // Eid'l Fitr (Regular - Tentative, pending proclamation)
    '2027-03-25', // Maundy Thursday (Regular)
    '2027-03-26', // Good Friday (Regular)
    '2027-03-27', // Black Saturday (Special Non-Working)
];

/**
 * Human-readable names for each holiday so the calendar can tell you *which*
 * holiday a date is, not just that it's excluded.
 */
export const HOLIDAY_NAMES: Record<string, string> = {
    '2026-01-01': "New Year's Day",
    '2026-02-17': 'Chinese New Year',
    '2026-03-20': "Eid'l Fitr",
    '2026-04-02': 'Maundy Thursday',
    '2026-04-03': 'Good Friday',
    '2026-04-04': 'Black Saturday',
    '2026-04-09': 'Araw ng Kagitingan',
    '2026-05-01': 'Labor Day',
    '2026-05-27': "Eid'l Adha",
    '2026-06-12': 'Independence Day',
    '2026-08-21': 'Ninoy Aquino Day',
    '2026-08-31': 'National Heroes Day',
    '2026-11-01': "All Saints' Day",
    '2026-11-02': "All Souls' Day",
    '2026-11-30': 'Bonifacio Day',
    '2026-12-08': 'Immaculate Conception',
    '2026-12-24': 'Christmas Eve',
    '2026-12-25': 'Christmas Day',
    '2026-12-30': 'Rizal Day',
    '2026-12-31': 'Last Day of the Year',
    '2027-01-01': "New Year's Day",
    '2027-02-06': 'Chinese New Year',
    '2027-03-10': "Eid'l Fitr",
    '2027-03-25': 'Maundy Thursday',
    '2027-03-26': 'Good Friday',
    '2027-03-27': 'Black Saturday',
};

export function getCurrentYear(): number {
    return new Date().getFullYear();
}

/**
 * Returns holidays that fall between Jan 1 of the given year and Mar 31
 * of the *next* year — so an OJT window that crosses the new year still
 * gets the right exclusions.
 */
export function holidaysForOjtWindow(year: number): string[] {
    const nextYear = year + 1;
    const windowStart = `${year}-01-01`;
    const windowEnd = `${nextYear}-03-31`;

    return PHILIPPINE_HOLIDAYS.filter(
        (value) => value >= windowStart && value <= windowEnd,
    );
}

export function buildDefaultSettings(): Settings {
    const now = new Date();
    const year = now.getFullYear();
    const todayIso = now.toISOString().split('T')[0];

    return {
        requiredHours: 486,
        startDate: todayIso,
        deadline: `${year + 1}-04-01`,
        lastRenderDay: `${year + 1}-03-31`,
        allowedWorkdays: [true, true, true, true, true, false, false],
        holidays: holidaysForOjtWindow(year),
        customExclusions: [],
        maxHoursPerDay: 12,
    };
}

export function buildEmptyData(): AppData {
    return {
        schemaVersion: 1,
        hasCompletedOnboarding: false,
        settings: buildDefaultSettings(),
        entries: {},
        lastExportedAt: null,
    };
}