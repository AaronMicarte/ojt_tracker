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

export function formatDisplayDate(dateValue: string): string {
    const [year, month, day] = dateValue.split('-').map(Number);
    if (!year || !month || !day) return '—';
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}

export function formatDisplayTime(isoValue: string | null): string {
    if (!isoValue) return '—';
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}

export function isFutureDate(dateValue: string, today: Date): boolean {
    const candidate = parseDateOnly(dateValue);
    candidate.setHours(0, 0, 0, 0);
    const t = new Date(today);
    t.setHours(0, 0, 0, 0);
    return candidate.getTime() > t.getTime();
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

export function workingDaysLeftFromToday(settings: Settings, today: Date): number {
    const lastRender = parseDateOnly(settings.lastRenderDay);
    if (Number.isNaN(lastRender.getTime())) return 0;

    let count = 0;
    const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    for (let current = new Date(cursor); current <= lastRender; current.setDate(current.getDate() + 1)) {
        if (isRenderDay(formatDateForInput(current), settings)) count += 1;
    }

    return count;
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
    const workdaysRendered = entriesList.filter((entry) =>
        isRenderDay(entry.date, settings),
    ).length;
    const workingDaysLeft = workingDaysLeftFromToday(settings, today);
    const hoursPerDayNeeded = workingDaysLeft > 0 ? hoursRemaining / workingDaysLeft : 0;

    if (totalHoursRendered >= settings.requiredHours) {
        return {
            totalHoursRendered,
            hoursRemaining: 0,
            workingDaysLeft,
            hoursPerDayNeeded: 0,
            avgPerWorkday: workdaysRendered > 0 ? totalHoursRendered / workdaysRendered : null,
            projectedFinish: 'Complete 🎉',
            status: 'complete',
            bufferOrDeficit: 0,
            daysNeeded: 0,
            workdaysRendered,
        };
    }

    const avgPerWorkday = workdaysRendered > 0 ? totalHoursRendered / workdaysRendered : null;

    // Not enough data: no rendered days yet, or zero average.
    // (Unlocked after the first rendered day so the projection shows immediately.)
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

    // Walk forward from today, skipping non-render days, to find the projected finish.
    let remaining = workdaysNeeded;
    const lastRenderDate = parseDateOnly(settings.lastRenderDay);
    let projectedDate = new Date(today);

    for (
        let cursor = new Date(today);
        cursor <= lastRenderDate;
        cursor.setDate(cursor.getDate() + 1)
    ) {
        const key = formatDateForInput(cursor);
        if (isRenderDay(key, settings)) {
            remaining -= 1;
            projectedDate = new Date(cursor);
            if (remaining <= 0) break;
        }
    }

    const projectedFinish = remaining <= 0 ? formatDateForInput(projectedDate) : null;
    const status: ProjectionResult['status'] = projectedFinish ? 'on-track' : 'behind';
    const bufferOrDeficit = workingDaysLeft - workdaysNeeded;

    return {
        totalHoursRendered,
        hoursRemaining,
        workingDaysLeft,
        hoursPerDayNeeded,
        avgPerWorkday,
        projectedFinish,
        status,
        bufferOrDeficit,
        daysNeeded: workdaysNeeded,
        workdaysRendered,
    };
}

export function isoDateComparer(a: string, b: string): number {
    return parseDateOnly(a).getTime() - parseDateOnly(b).getTime();
}

export function sanitizeNumericInput(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}