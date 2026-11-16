import { DayEntry, ProjectionResult, Settings } from './types';

export function parseDateOnly(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
}

export function formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getWeekdayIndex(date: Date): number {
    return (date.getDay() + 6) % 7; // Mon = 0 ... Sun = 6
}

export function isFutureDate(dateValue: string, today: Date): boolean {
    const candidate = parseDateOnly(dateValue);
    candidate.setHours(0, 0, 0, 0);
    const t = new Date(today);
    t.setHours(0, 0, 0, 0);
    return candidate.getTime() > t.getTime();
}

// True when the date is earlier than the configured OJT start date.
export function isBeforeStart(dateValue: string, settings: Settings): boolean {
    if (!settings.startDate) return false;
    const candidate = parseDateOnly(dateValue);
    const start = parseDateOnly(settings.startDate);
    if (Number.isNaN(candidate.getTime()) || Number.isNaN(start.getTime())) return false;
    candidate.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);
    return candidate.getTime() < start.getTime();
}

export function isRenderDay(dateValue: string, settings: Settings): boolean {
    const date = parseDateOnly(dateValue);
    const lastRenderDay = parseDateOnly(settings.lastRenderDay);
    if (Number.isNaN(date.getTime()) || Number.isNaN(lastRenderDay.getTime())) return false;
    if (date > lastRenderDay) return false;

    const weekdayIndex = getWeekdayIndex(date);
    if (!settings.allowedWorkdays[weekdayIndex]) return false;

    const dateKey = formatDateForInput(date);
    if (settings.holidays.includes(dateKey)) return false;
    if (settings.customExclusions.includes(dateKey)) return false;

    return true;
}

export function getDayHoursFromEntry(entry: DayEntry): number {
    const sessionMinutes = (start: string | null, end: string | null): number => {
        if (!start || !end) return 0;
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
        const ms = endDate.getTime() - startDate.getTime();
        return Math.max(0, ms / 60000);
    };

    const totalMinutes =
        sessionMinutes(entry.amTimeIn, entry.amTimeOut) +
        sessionMinutes(entry.pmTimeIn, entry.pmTimeOut);

    return totalMinutes / 60;
}

export function buildEntry(date: string): DayEntry {
    const nowIso = new Date().toISOString();
    return {
        date,
        amTimeIn: null,
        amTimeOut: null,
        pmTimeIn: null,
        pmTimeOut: null,
        notes: '',
        edited: false,
        createdAt: nowIso,
        updatedAt: nowIso,
    };
}

function hasHoursOn(entries: Record<string, DayEntry>, key: string): boolean {
    const entry = entries[key];
    return !!entry && getDayHoursFromEntry(entry) > 0;
}

export function workingDaysLeftFromToday(
    settings: Settings,
    today: Date,
    entries: Record<string, DayEntry> = {},
): number {
    const lastRender = parseDateOnly(settings.lastRenderDay);
    if (Number.isNaN(lastRender.getTime())) return 0;

    let count = 0;

    // Start counting from today
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // If you already logged hours today, start counting from TOMORROW
    if (hasHoursOn(entries, formatDateForInput(start))) {
        start.setDate(start.getDate() + 1);
    }

    for (
        let current = new Date(start);
        current <= lastRender;
        current.setDate(current.getDate() + 1)
    ) {
        if (isRenderDay(formatDateForInput(current), settings)) count += 1;
    }

    return count;
}

export function computeProjection(
    settings: Settings,
    entries: Record<string, DayEntry>,
    today: Date,
): ProjectionResult {
    const entriesList = Object.values(entries);
    const totalHoursRendered = entriesList.reduce(
        (sum, entry) => sum + getDayHoursFromEntry(entry),
        0,
    );
    const hoursRemaining = Math.max(0, settings.requiredHours - totalHoursRendered);

    const workdaysRendered = entriesList.filter(
        (entry) => getDayHoursFromEntry(entry) > 0,
    ).length;

    const workingDaysLeft = workingDaysLeftFromToday(settings, today, entries);
    const hoursPerDayNeeded = workingDaysLeft > 0 ? hoursRemaining / workingDaysLeft : 0;
    const avgPerWorkday = workdaysRendered > 0 ? totalHoursRendered / workdaysRendered : null;

    if (totalHoursRendered >= settings.requiredHours) {
        return {
            totalHoursRendered,
            hoursRemaining: 0,
            workingDaysLeft,
            hoursPerDayNeeded: 0,
            avgPerWorkday,
            projectedFinish: 'Complete 🎉',
            status: 'complete',
            bufferOrDeficit: 0,
            daysNeeded: 0,
            workdaysRendered,
        };
    }

    if (workdaysRendered < 1 || !avgPerWorkday || avgPerWorkday <= 0) {
        return {
            totalHoursRendered,
            hoursRemaining,
            workingDaysLeft,
            hoursPerDayNeeded,
            avgPerWorkday,
            projectedFinish: null,
            status: 'not-enough-data',
            bufferOrDeficit: 0,
            daysNeeded: 0,
            workdaysRendered,
        };
    }

    const workdaysNeeded = Math.ceil(hoursRemaining / avgPerWorkday);

    let remaining = workdaysNeeded;
    const lastRenderDate = parseDateOnly(settings.lastRenderDay);

    // For the projection loop, we use the exact same starting rule
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (hasHoursOn(entries, formatDateForInput(start))) {
        start.setDate(start.getDate() + 1);
    }

    let projectedDate = new Date(start);

    for (
        let cursor = new Date(start);
        cursor <= lastRenderDate;
        cursor.setDate(cursor.getDate() + 1)
    ) {
        if (isRenderDay(formatDateForInput(cursor), settings)) {
            remaining -= 1;
            projectedDate = new Date(cursor);
            if (remaining <= 0) break;
        }
    }

    const projectedFinish = remaining <= 0 ? formatDateForInput(projectedDate) : null;
    const status: ProjectionResult['status'] = projectedFinish ? 'on-track' : 'behind';

    return {
        totalHoursRendered,
        hoursRemaining,
        workingDaysLeft,
        hoursPerDayNeeded,
        avgPerWorkday,
        projectedFinish,
        status,
        bufferOrDeficit: workingDaysLeft - workdaysNeeded,
        daysNeeded: workdaysNeeded,
        workdaysRendered,
    };
}