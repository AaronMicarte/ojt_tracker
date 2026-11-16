import { AppData, Settings } from './types';
import { formatDateForInput } from './utils';

export const STORAGE_KEY = 'ojt_tracker_data_v1';

// Hardcoded PH Holidays for the Nov 2026 - Mar 2027 window
export const PHILIPPINE_HOLIDAYS: string[] = [
    '2026-11-01', // All Saints' Day
    '2026-11-02', // All Souls' Day
    '2026-11-30', // Bonifacio Day
    '2026-12-08', // Immaculate Conception
    '2026-12-24', // Christmas Eve
    '2026-12-25', // Christmas Day
    '2026-12-30', // Rizal Day
    '2026-12-31', // Last Day of the Year

    // 2027
    '2027-01-01', // New Year's Day
    '2027-02-06', // Chinese New Year
    '2027-03-25', // Maundy Thursday
    '2027-03-26', // Good Friday
    '2027-03-27', // Black Saturday
];

export const HOLIDAY_NAMES: Record<string, string> = {
    '2026-11-01': "All Saints' Day", '2026-11-02': "All Souls' Day", '2026-11-30': 'Bonifacio Day',
    '2026-12-08': 'Immaculate Conception', '2026-12-24': 'Christmas Eve', '2026-12-25': 'Christmas Day',
    '2026-12-30': 'Rizal Day', '2026-12-31': 'Last Day of the Year',
    '2027-01-01': "New Year's Day", '2027-02-06': 'Chinese New Year', '2027-03-25': 'Maundy Thursday',
    '2027-03-26': 'Good Friday', '2027-03-27': 'Black Saturday',
};

export function getCurrentYear(): number {
    return new Date().getFullYear();
}

export function holidaysForOjtWindow(_year: number): string[] {
    // Simply return the whole list, since we hardcoded the specific window dates above.
    return [...PHILIPPINE_HOLIDAYS];
}

export function buildDefaultSettings(): Settings {
    return {
        requiredHours: 486,
        startDate: '2026-11-23',     // <--- CHANGED TO NOV 23
        deadline: '2027-03-26',      // Hardcoded End
        lastRenderDay: '2027-03-26', // Match deadline
        allowedWorkdays: [true, true, true, true, true, false, false], // Mon-Fri
        holidays: PHILIPPINE_HOLIDAYS,
        customExclusions: [],
        customExclusionNames: {},
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