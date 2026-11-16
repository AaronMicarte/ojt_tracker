import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildEmptyData } from './defaults';
import { AppData } from './types';

export const DATA_KEY = 'ojt_tracker_data_v1';

export async function loadAppData(): Promise<AppData> {
    try {
        const raw = await AsyncStorage.getItem(DATA_KEY);
        if (!raw) return buildEmptyData();

        const parsed = JSON.parse(raw) as Partial<AppData>;
        const base = buildEmptyData();

        return {
            ...base,
            ...parsed,
            settings: { ...base.settings, ...(parsed.settings || {}) },
            entries: parsed.entries || {},
        };
    } catch {
        return buildEmptyData();
    }
}

export async function saveAppData(data: AppData): Promise<void> {
    await AsyncStorage.setItem(DATA_KEY, JSON.stringify(data));
}

export async function exportJsonBackup(data: AppData): Promise<string> {
    return JSON.stringify(data, null, 2);
}

export async function importJsonBackup(data: string): Promise<AppData> {
    const parsed = JSON.parse(data) as AppData;
    if (!parsed || typeof parsed !== 'object' || !parsed.settings) {
        throw new Error('Invalid backup file');
    }
    return { ...buildEmptyData(), ...parsed, schemaVersion: 1 };
}