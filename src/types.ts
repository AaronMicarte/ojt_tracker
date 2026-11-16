export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Settings {
    requiredHours: number;
    startDate: string;
    deadline: string;
    lastRenderDay: string;
    allowedWorkdays: boolean[];
    holidays: string[];
    customExclusions: string[];
    maxHoursPerDay: number;
}

export interface DayEntry {
    date: string;
    amTimeIn: string | null;
    amTimeOut: string | null;
    pmTimeIn: string | null;
    pmTimeOut: string | null;
    notes: string;
    edited: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface AppData {
    schemaVersion: number;
    hasCompletedOnboarding: boolean;
    settings: Settings;
    entries: Record<string, DayEntry>;
    lastExportedAt?: string | null;
}

export interface ProjectionResult {
    totalHoursRendered: number;
    hoursRemaining: number;
    workingDaysLeft: number;
    hoursPerDayNeeded: number;
    avgPerWorkday: number | null;
    projectedFinish: string | null;
    status: 'complete' | 'on-track' | 'behind' | 'not-enough-data';
    bufferOrDeficit: number;
    daysNeeded: number;
    workdaysRendered: number;
}