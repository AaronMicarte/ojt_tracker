// App.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import * as NavigationBar from 'expo-navigation-bar';

import { Ionicons } from '@expo/vector-icons';

import { buildEmptyData, HOLIDAY_NAMES } from './src/defaults';
import { AppData, DayEntry, Settings } from './src/types';
import {
  buildEntry,
  computeProjection,
  formatDateForInput,
  getDayHoursFromEntry,
  isBeforeStart,
  isFutureDate,
  isRenderDay,
  parseDateOnly,
} from './src/utils';
import {
  exportJsonBackup,
  importJsonBackup,
  loadAppData,
  saveAppData,
} from './src/storage';
import { colors, radius, space } from './src/theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

type ScreenName = 'onboarding' | 'dashboard' | 'daily-log' | 'calendar' | 'settings';
type TimeFieldKey = 'amTimeIn' | 'amTimeOut' | 'pmTimeIn' | 'pmTimeOut';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CALENDAR_HEADER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const EXCLUDED = { bg: colors.neutralSoft, fg: colors.textSecondary };

const TIME_SUGGESTIONS: Record<TimeFieldKey, { h: number; m: number }> = {
  amTimeIn: { h: 8, m: 0 }, amTimeOut: { h: 12, m: 0 },
  pmTimeIn: { h: 13, m: 0 }, pmTimeOut: { h: 17, m: 0 },
};

const ENTRY_FIELDS: (keyof DayEntry)[] = ['amTimeIn', 'amTimeOut', 'pmTimeIn', 'pmTimeOut', 'notes'];

const REMINDER_ID = 'ojt-daily-reminder';
const REMINDER_CHANNEL = 'reminders';

const TABS: { key: Exclude<ScreenName, 'onboarding'>; label: string; icon: IconName; iconActive: IconName }[] = [
  { key: 'dashboard', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { key: 'daily-log', label: 'Log', icon: 'create-outline', iconActive: 'create' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline', iconActive: 'calendar' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', iconActive: 'settings' },
];

function isoAt(dateKey: string, hour: number, minute: number): string {
  const base = parseDateOnly(dateKey);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0).toISOString();
}

function makeLocalIsoFromTime(dateKey: string, time: Date): string {
  const base = parseDateOnly(dateKey);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), time.getHours(), time.getMinutes(), 0).toISOString();
}

function formatClock12(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const h = date.getHours();
  const m = date.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatDateLabel(isoDate: string): string {
  if (!isoDate) return '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return '—';
  return `${MONTH_SHORT[month - 1]} ${day}, ${year}`;
}

function formatLongDate(isoDate: string): string {
  if (!isoDate) return '—';
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return '—';
  const d = new Date(year, month - 1, day);
  return `${WEEKDAY_SHORT[d.getDay()]}, ${MONTH_SHORT[month - 1]} ${day}, ${year}`;
}

function suggestionDate(dateKey: string, field: TimeFieldKey): Date {
  const s = TIME_SUGGESTIONS[field];
  return new Date(isoAt(dateKey, s.h, s.m));
}

function getMonthMatrix(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(formatDateForInput(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

type BtnProps = {
  label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger';
  icon?: IconName; disabled?: boolean; style?: StyleProp<ViewStyle>;
};

function Btn({ label, onPress, variant = 'primary', icon, disabled, style }: BtnProps) {
  const fg = variant === 'primary' ? '#FFFFFF' : variant === 'danger' ? colors.danger : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [
        styles.btn, variant === 'primary' && styles.btnPrimary, variant === 'secondary' && styles.btnSecondary,
        variant === 'danger' && styles.btnDanger, pressed && { opacity: 0.8 }, disabled && { opacity: 0.4 }, style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={17} color={fg} style={{ marginRight: 7 }} /> : null}
      <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function CardTitle({ title, hint }: { icon?: IconName; title: string; hint?: string }) {
  return (
    <View style={{ marginBottom: space.sm }}>
      <Text style={styles.cardTitle}>{title}</Text>
      {hint ? <Text style={styles.inputHint}>{hint}</Text> : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

type NumberFieldProps = { label: string; value: number; min: number; max: number; suffix?: string; hint?: string; onCommit: (value: number) => void; };

function NumberField({ label, value, min, max, suffix, hint, onCommit }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(text.replace(/[^0-9.]/g, ''));
    if (!text.trim() || !Number.isFinite(n) || n < min) { setText(String(value)); return; }
    const clamped = Math.min(max, n);
    setText(String(clamped));
    onCommit(clamped);
  };
  return (
    <View style={{ marginTop: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput style={[styles.input, { flex: 1 }]} keyboardType="decimal-pad" value={text} onChangeText={setText} onBlur={commit} onEndEditing={commit} selectTextOnFocus />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
      {hint ? <Text style={styles.inputHint}>{hint}</Text> : null}
    </View>
  );
}

type NativePickerProps = { mode: 'date' | 'time'; value: Date; maximumDate?: Date; minimumDate?: Date; onConfirm: (value: Date) => void; onCancel: () => void; };

function NativePicker({ mode, value, maximumDate, minimumDate, onConfirm, onCancel }: NativePickerProps) {
  const [draft, setDraft] = useState(value);
  if (Platform.OS === 'android') {
    return (
      <DateTimePicker value={value} mode={mode} display={mode === 'date' ? 'calendar' : 'spinner'} maximumDate={maximumDate} minimumDate={minimumDate}
        onChange={(event: DateTimePickerEvent, picked?: Date) => {
          if (event.type === 'set' && picked) onConfirm(picked);
          else onCancel();
        }}
      />
    );
  }
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHeader}>
            <Pressable onPress={onCancel} hitSlop={10}><Text style={styles.pickerCancel}>Cancel</Text></Pressable>
            <Pressable onPress={() => onConfirm(draft)} hitSlop={10}><Text style={styles.pickerDone}>Done</Text></Pressable>
          </View>
          <DateTimePicker value={draft} mode={mode} display={mode === 'date' ? 'inline' : 'spinner'} maximumDate={maximumDate} minimumDate={minimumDate}
            onChange={(_event: DateTimePickerEvent, picked?: Date) => { if (picked) setDraft(picked); }} />
        </View>
      </View>
    </Modal>
  );
}

type TimeFieldProps = { label: string; fieldKey: TimeFieldKey; value: string | null; selectedDate: string; onChange: (value: string | null) => void; };

function TimeField({ label, fieldKey, value, selectedDate, onChange }: TimeFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  const suggestion = suggestionDate(selectedDate, fieldKey);
  const current = value ? new Date(value) : suggestion;
  const isSuggested = !value;
  return (
    <View style={styles.timeFieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} time`} style={styles.timeButton} onPress={() => setShowPicker(true)}>
        <Text style={[styles.timeButtonText, isSuggested && styles.timeButtonTextSuggested]}>
          {isSuggested ? 'Set time' : formatClock12(value)}
        </Text>
        {value ? (
          <Pressable hitSlop={10} accessibilityLabel={`Clear ${label}`} onPress={() => onChange(null)} style={styles.timeClear}>
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </Pressable>
      {showPicker && (
        <NativePicker mode="time" value={current} onCancel={() => setShowPicker(false)}
          onConfirm={(picked) => { setShowPicker(false); onChange(makeLocalIsoFromTime(selectedDate, picked)); }} />
      )}
    </View>
  );
}

type DateFieldProps = { label: string; value: string; onChange: (value: string) => void; maximumDate?: Date; minimumDate?: Date; };

function DateField({ label, value, onChange, maximumDate, minimumDate }: DateFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  const current = value ? parseDateOnly(value) : new Date();
  return (
    <View style={{ marginTop: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.inputButton} onPress={() => setShowPicker(true)}>
        <Text style={[styles.inputButtonText, !value && { color: colors.textSecondary, fontWeight: '400' }]}>
          {value ? formatLongDate(value) : 'Select date'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
      </Pressable>
      {showPicker && (
        <NativePicker mode="date" value={current} maximumDate={maximumDate} minimumDate={minimumDate}
          onCancel={() => setShowPicker(false)} onConfirm={(picked) => { setShowPicker(false); onChange(formatDateForInput(picked)); }} />
      )}
    </View>
  );
}

function AddExclusionButton({ onPick }: { onPick: (dateKey: string) => void }) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <>
      <Btn label="Add excluded date" icon="add" variant="secondary" onPress={() => setShowPicker(true)} />
      {showPicker && (
        <NativePicker mode="date" value={new Date()} onCancel={() => setShowPicker(false)}
          onConfirm={(picked) => { setShowPicker(false); onPick(formatDateForInput(picked)); }} />
      )}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar hidden={true} />
      <Root />
    </SafeAreaProvider>
  );
}
function Root() {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
    }
  }, []);
  const [appData, setAppData] = useState<AppData>(buildEmptyData());
  const [isLoading, setIsLoading] = useState(true);
  const [screen, setScreen] = useState<ScreenName>('onboarding');
  const [selectedDate, setSelectedDate] = useState(formatDateForInput(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [focusEntry, setFocusEntry] = useState<DayEntry | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [calendarDetailDate, setCalendarDetailDate] = useState<string | null>(null);
  const [reminderOn, setReminderOn] = useState(false);
  const [kbVisible, setKbVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const [showExclusionModal, setShowExclusionModal] = useState(false);
  const [pendingExclusionDate, setPendingExclusionDate] = useState('');
  const [exclusionNameInput, setExclusionNameInput] = useState('');

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayKey = formatDateForInput(new Date());

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKbVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    const hydrate = async () => {
      try {
        const data = await loadAppData();
        setAppData(data);
        setScreen(data.hasCompletedOnboarding ? 'dashboard' : 'onboarding');
      } catch {
        setAppData(buildEmptyData());
        setScreen('onboarding');
      } finally { setIsLoading(false); }
    };
    hydrate();
  }, []);

  useEffect(() => {
    if (!isLoading) saveAppData(appData).catch(() => undefined);
  }, [appData, isLoading]);

  useEffect(() => {
    const existing = appData.entries[selectedDate] || buildEntry(selectedDate);
    setFocusEntry(existing);
  }, [selectedDate, appData.entries]);

  const refreshReminderStatus = async () => {
    try {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      setReminderOn(all.some((n) => n.identifier === REMINDER_ID));
    } catch { setReminderOn(false); }
  };

  useEffect(() => { if (screen === 'settings') refreshReminderStatus(); }, [screen]);

  const projection = useMemo(() => computeProjection(appData.settings, appData.entries, new Date()), [appData.entries, appData.settings]);
  const currentEntry = appData.entries[selectedDate] || buildEntry(selectedDate);
  const workingEntry = focusEntry || currentEntry;
  const dirty = ENTRY_FIELDS.some((k) => (workingEntry[k] ?? '') !== (currentEntry[k] ?? ''));

  const updateSettings = (changes: Partial<Settings>) => {
    setAppData((prev) => ({ ...prev, settings: { ...prev.settings, ...changes } }));
  };

  const patchEntry = (patch: Partial<DayEntry>) => {
    setFocusEntry((prev) => ({
      ...(prev || buildEntry(selectedDate)), date: selectedDate, ...patch,
      updatedAt: new Date().toISOString(), edited: true,
    }));
  };

  const guardedSetDate = (key: string, after?: () => void) => {
    if (key === selectedDate) { after?.(); return; }
    if (isFutureDate(key, new Date())) { Alert.alert('Future date', 'You can only log today or earlier.'); return; }
    if (isBeforeStart(key, appData.settings)) {
      Alert.alert('Before your OJT start', `Your OJT starts on ${formatDateLabel(appData.settings.startDate)}. You can't log earlier than that.`);
      return;
    }
    const go = () => { setSelectedDate(key); after?.(); };
    if (dirty) {
      Alert.alert('Discard changes?', 'You have unsaved changes for this day.', [
        { text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: go },
      ]);
    } else { go(); }
  };

  const shiftDay = (delta: number) => {
    const d = parseDateOnly(selectedDate);
    d.setDate(d.getDate() + delta);
    guardedSetDate(formatDateForInput(d));
  };

  const persistEntry = (entry: DayEntry, now: string) => {
    setAppData((prev) => ({
      ...prev,
      entries: { ...prev.entries, [entry.date]: { ...entry, edited: entry.edited || !!prev.entries[entry.date], updatedAt: now } },
    }));
    showToast(`Saved ${formatDateLabel(entry.date)}`);
    setScreen('dashboard');
  };

  const saveEntry = (entry: DayEntry) => {
    const now = new Date().toISOString();
    if (isFutureDate(entry.date, new Date())) { Alert.alert('Invalid date', 'Future dates are not allowed.'); return; }
    if (isBeforeStart(entry.date, appData.settings)) { Alert.alert('Before your OJT start', `Your OJT starts on ${formatDateLabel(appData.settings.startDate)}.`); return; }
    const amIn = entry.amTimeIn ? new Date(entry.amTimeIn) : null;
    const amOut = entry.amTimeOut ? new Date(entry.amTimeOut) : null;
    const pmIn = entry.pmTimeIn ? new Date(entry.pmTimeIn) : null;
    const pmOut = entry.pmTimeOut ? new Date(entry.pmTimeOut) : null;
    if (!amIn && !amOut && !pmIn && !pmOut && !entry.notes?.trim()) { Alert.alert('Nothing to save', 'Set at least one time or add a note.'); return; }
    if (amIn && amOut && amOut.getTime() <= amIn.getTime()) { Alert.alert('Check morning times', 'AM out must be later than AM in.'); return; }
    if (pmIn && pmOut && pmOut.getTime() <= pmIn.getTime()) { Alert.alert('Check afternoon times', 'PM out must be later than PM in.'); return; }
    const morningEnd = amOut || amIn;
    if (morningEnd && pmIn && pmIn.getTime() < morningEnd.getTime()) { Alert.alert('Check your times', 'PM in must be later than the morning times.'); return; }
    const dayHours = getDayHoursFromEntry(entry);
    const warnings: string[] = [];
    if ((amIn && !amOut) || (!amIn && amOut)) warnings.push('Morning has only one time, so it will not count toward your hours.');
    if ((pmIn && !pmOut) || (!pmIn && pmOut)) warnings.push('Afternoon has only one time, so it will not count toward your hours.');
    if (dayHours > appData.settings.maxHoursPerDay) warnings.push(`This day totals ${dayHours.toFixed(1)}h, above your ${appData.settings.maxHoursPerDay}h soft cap.`);
    if (dayHours > 0 && !isRenderDay(entry.date, appData.settings)) warnings.push('This is not a render day (weekend, holiday, or excluded).');
    if (warnings.length) {
      Alert.alert('Double-check this day', warnings.join('\n\n'), [{ text: 'Edit', style: 'cancel' }, { text: 'Save anyway', onPress: () => persistEntry(entry, now) }]);
      return;
    }
    persistEntry(entry, now);
  };

  const handleSaveCurrentEntry = () => { saveEntry(focusEntry || { ...currentEntry, updatedAt: new Date().toISOString() }); };

  const fillDefaultDay = () => {
    patchEntry({ amTimeIn: isoAt(selectedDate, 8, 0), amTimeOut: isoAt(selectedDate, 12, 0), pmTimeIn: isoAt(selectedDate, 13, 0), pmTimeOut: isoAt(selectedDate, 17, 0) });
  };

  const clearTimes = () => { patchEntry({ amTimeIn: null, amTimeOut: null, pmTimeIn: null, pmTimeOut: null }); };

  const handleCompletedOnboarding = () => {
    const s = appData.settings;
    if (!s.requiredHours || s.requiredHours <= 0) { Alert.alert('Required hours', 'Enter how many hours you need to render.'); return; }
    if (!s.startDate || !s.deadline || !s.lastRenderDay) { Alert.alert('Missing dates', 'Pick your start date, deadline, and last render day.'); return; }
    if (s.deadline < s.startDate || s.lastRenderDay < s.startDate) { Alert.alert('Check your dates', 'Deadline and last render day must be after your start date.'); return; }
    if (!s.allowedWorkdays.some(Boolean)) { Alert.alert('Workdays', 'Turn on at least one workday.'); return; }
    setAppData((prev) => ({ ...prev, hasCompletedOnboarding: true }));
    setScreen('dashboard');
  };

  const handleBackupExport = async () => {
    try {
      const text = await exportJsonBackup(appData);
      const result = await Share.share({ title: 'OJT Tracker backup', message: `Backup file for OJT Tracker\n\n${text}` });
      if (result.action === Share.sharedAction) {
        setAppData((prev) => ({ ...prev, lastExportedAt: new Date().toISOString() }));
        showToast('Backup exported');
      }
    } catch { Alert.alert('Export failed', 'Could not export the backup.'); }
  };

  const restoreFromText = async (text: string): Promise<boolean> => {
    try {
      const imported = await importJsonBackup(extractJson(text.trim()));
      setAppData(imported);
      showToast('Backup restored');
      return true;
    } catch {
      Alert.alert('Import failed', 'That backup could not be restored. Make sure you copied the whole backup text.');
      return false;
    }
  };

  const runImportFromFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (result.canceled || !result.assets?.length) return;
      const response = await fetch(result.assets[0].uri);
      const text = await response.text();
      await restoreFromText(text);
    } catch { Alert.alert('Import failed', 'The selected file could not be read.'); }
  };

  const handleBackupImport = () => {
    Alert.alert('Replace current data?', 'Importing a backup replaces everything on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Paste text', style: 'destructive', onPress: () => setShowPasteImport(true) },
      { text: 'Choose file', style: 'destructive', onPress: runImportFromFile },
    ]);
  };

  const confirmPasteImport = async () => {
    if (!pasteText.trim()) { Alert.alert('Nothing to import', 'Paste your backup text first.'); return; }
    const ok = await restoreFromText(pasteText);
    if (ok) { setShowPasteImport(false); setPasteText(''); }
  };

  const enableReminder = async () => {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, { name: 'Daily reminder', importance: Notifications.AndroidImportance.DEFAULT });
      }
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        const permission = await Notifications.requestPermissionsAsync();
        if (permission.status !== 'granted') { Alert.alert('Permission needed', 'Turn on notifications for this app in your phone settings.'); return; }
      }
      await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => undefined);
      await Notifications.scheduleNotificationAsync({
        identifier: REMINDER_ID,
        content: { title: 'Still working?', body: 'Log your OJT hours before you finish the day.' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 18, minute: 0, channelId: REMINDER_CHANNEL },
      });
      setReminderOn(true);
      showToast('Daily reminder set for 6:00 PM');
    } catch { Alert.alert('Reminder failed', 'Could not schedule the reminder on this device.'); }
  };

  const disableReminder = async () => {
    try { await Notifications.cancelScheduledNotificationAsync(REMINDER_ID); } catch { /* ignore */ }
    setReminderOn(false);
    showToast('Reminder turned off');
  };

  const deleteEntry = (dateKey: string) => {
    setAppData((prev) => {
      const next = { ...prev.entries };
      delete next[dateKey];
      return { ...prev, entries: next };
    });
  };

  const confirmDeleteEntry = (dateKey: string) => {
    Alert.alert('Delete this log?', `Remove all hours logged on ${formatDateLabel(dateKey)}? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteEntry(dateKey); setCalendarDetailDate(null); showToast('Log deleted'); } },
    ]);
  };

  const confirmResetAll = () => {
    Alert.alert('Reset all data?', 'This deletes every log and setting on this device. Export a backup first if you need one.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset everything', style: 'destructive', onPress: async () => {
          await disableReminder();
          setAppData((prev) => ({ ...buildEmptyData(), lastExportedAt: prev.lastExportedAt }));
          setScreen('onboarding');
        }
      },
    ]);
  };

  const editFromCalendar = (dateKey: string) => {
    guardedSetDate(dateKey, () => { setCalendarDetailDate(null); setScreen('daily-log'); });
  };

  const noDaysLeft = projection.status !== 'complete' && projection.workingDaysLeft === 0 && projection.hoursRemaining > 0;

  const pill = noDaysLeft
    ? { bg: colors.dangerSoft, fg: colors.danger, label: 'No days left' }
    : projection.status === 'complete' ? { bg: colors.successSoft, fg: colors.success, label: 'Complete' }
      : projection.status === 'on-track' ? { bg: colors.successSoft, fg: colors.success, label: 'On track' }
        : projection.status === 'behind' ? { bg: colors.dangerSoft, fg: colors.danger, label: 'Behind' }
          : { bg: colors.warnSoft, fg: colors.warn, label: 'Needs data' };

  const progressPct = appData.settings.requiredHours
    ? Math.min(100, (projection.totalHoursRendered / appData.settings.requiredHours) * 100)
    : 0;

  const renderWorkdayChips = () => (
    <View style={styles.chipRow}>
      {DAY_LABELS.map((day, index) => {
        const on = appData.settings.allowedWorkdays[index];
        return (
          <Pressable key={day} accessibilityRole="button" accessibilityLabel={`${day} ${on ? 'on' : 'off'}`}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => {
              const next = [...appData.settings.allowedWorkdays];
              next[index] = !next[index];
              updateSettings({ allowedWorkdays: next });
            }}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{day}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const renderOnboarding = () => (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Set up your OJT plan</Text>
      <Text style={styles.subtitle}>Your data stays on this phone. Nothing is uploaded.</Text>
      <Card>
        <CardTitle title="Hours" />
        <NumberField label="Required hours" value={appData.settings.requiredHours || 486} min={1} max={5000} suffix="h" onCommit={(v) => updateSettings({ requiredHours: v })} />
        <NumberField
          label="Soft cap per day"
          value={appData.settings.maxHoursPerDay || 12}
          min={1}
          max={24}
          suffix="h"
          hint="A warning limit, not a hard lock. If you log more than this in one day, the app will ask you to double-check your hours (to catch typos), but you can still save it."
          onCommit={(v) => updateSettings({ maxHoursPerDay: v })}
        />
      </Card>
      <Card>
        <CardTitle title="Dates" hint="The deadline and last render day are the same. Pick your end date here." />
        <DateField label="OJT start date" value={appData.settings.startDate} onChange={(v) => updateSettings({ startDate: v })} />
        <DateField label="Deadline & last render day" value={appData.settings.deadline} minimumDate={appData.settings.startDate ? parseDateOnly(appData.settings.startDate) : undefined} onChange={(v) => updateSettings({ deadline: v, lastRenderDay: v })} />
      </Card>
      <Card>
        <CardTitle title="Workdays" hint="Tap the days you report for OJT." />
        {renderWorkdayChips()}
      </Card>
      <Btn label="Continue" onPress={handleCompletedOnboarding} />
    </ScrollView>
  );

  const renderDashboard = () => {
    const todayEntry = appData.entries[todayKey];
    const todayHours = todayEntry ? getDayHoursFromEntry(todayEntry) : 0;
    const deadline = appData.settings.deadline;
    const daysToDeadline = deadline ? Math.ceil((parseDateOnly(deadline).getTime() - parseDateOnly(todayKey).getTime()) / 86400000) : null;
    const buffer = Number(projection.bufferOrDeficit);
    const bufferText = Number.isFinite(buffer) ? buffer >= 0 ? `${buffer} workday${buffer === 1 ? '' : 's'} to spare` : `${Math.abs(buffer)} workday${Math.abs(buffer) === 1 ? '' : 's'} short` : '—';

    return (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitleTop}>{formatLongDate(todayKey)}</Text>
        <Text style={styles.title}>OJT Tracker</Text>

        <View style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <Text style={styles.heroEyebrow}>Hours needed per day</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: pill.fg }]} />
              <Text style={[styles.statusText, { color: pill.fg }]}>{pill.label}</Text>
            </View>
          </View>
          <Text style={styles.heroValue}>
            {noDaysLeft ? '—' : <Text>{projection.hoursPerDayNeeded.toFixed(1)}<Text style={styles.heroUnit}> h</Text></Text>}
          </Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progressPct}%` }]} /></View>
          <View style={styles.heroFooterRow}>
            <Text style={styles.heroFooter}>{projection.totalHoursRendered.toFixed(1)} of {appData.settings.requiredHours} h</Text>
            <Text style={styles.heroFooter}>{progressPct.toFixed(0)}%</Text>
          </View>
        </View>

        <Card>
          <View style={styles.todayRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Today</Text>
              <Text style={styles.helperText}>{todayHours > 0 ? `${todayHours.toFixed(1)}h logged` : isRenderDay(todayKey, appData.settings) ? 'Nothing logged yet' : 'Not a render day'}</Text>
            </View>
            <Btn label={todayHours > 0 ? 'Edit' : 'Log hours'} onPress={() => guardedSetDate(todayKey, () => setScreen('daily-log'))} style={{ paddingHorizontal: space.lg }} />
          </View>
        </Card>

        <Card>
          <CardTitle title="Overview" />
          <View style={styles.metaGrid}>
            <Stat label="Working days left" value={String(projection.workingDaysLeft)} />
            <Stat label="Hours remaining" value={`${projection.hoursRemaining.toFixed(1)}h`} />
            <Stat label="Average per day" value={projection.avgPerWorkday ? `${projection.avgPerWorkday.toFixed(1)}h` : '—'} />
            <Stat label="Days logged" value={String(projection.workdaysRendered)} />
            <Stat label="Days to deadline" value={daysToDeadline === null ? '—' : daysToDeadline < 0 ? 'Past due' : String(daysToDeadline)} />
          </View>
        </Card>

        <Card>
          <CardTitle title="Projection" />
          {projection.status === 'not-enough-data' ? (
            <View>
              <Text style={styles.warnText}>Log your first day to see your projection</Text>
              <Text style={styles.helperText}>
                We only need one completed day to calculate your initial pace, so you don't have to wait three days to see your progress.
                Just note that this early projection is based on a single shift—it will become much more accurate as you log more days.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.kvRow}>
                <Text style={styles.kvLabel}>Projected finish</Text>
                <Text style={styles.kvValue}>{projection.status === 'complete' ? 'Done' : projection.projectedFinish ? formatDateLabel(projection.projectedFinish) : 'After last render day'}</Text>
              </View>
              {projection.status !== 'complete' && (
                <View style={styles.kvRow}>
                  <Text style={styles.kvLabel}>Pace</Text>
                  <Text style={styles.kvValue}>{bufferText}</Text>
                </View>
              )}
              <View style={styles.kvRow}>
                <Text style={styles.kvLabel}>Last render day</Text>
                <Text style={styles.kvValue}>{formatDateLabel(appData.settings.lastRenderDay)}</Text>
              </View>
              <View style={[styles.kvRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.kvLabel}>Deadline</Text>
                <Text style={styles.kvValue}>{formatDateLabel(appData.settings.deadline)}</Text>
              </View>
            </>
          )}
        </Card>
      </ScrollView>
    );
  };

  const renderDailyLog = () => {
    const hours = getDayHoursFromEntry(workingEntry);
    const renderDay = isRenderDay(selectedDate, appData.settings);
    const isToday = selectedDate >= todayKey;

    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Daily log</Text>
          <View style={styles.dateNav}>
            <Pressable accessibilityLabel="Previous day" style={styles.calNavBtn} onPress={() => shiftDay(-1)}><Ionicons name="chevron-back" size={18} color={colors.textPrimary} /></Pressable>
            <Pressable accessibilityLabel="Pick a date" style={styles.dateNavCenter} onPress={() => setShowDatePicker(true)}>
              <Text style={styles.dateNavText}>{formatLongDate(selectedDate)}</Text>
              <Text style={styles.dateNavSub}>{selectedDate === todayKey ? 'Today' : 'Tap to change'}</Text>
            </Pressable>
            <Pressable accessibilityLabel="Next day" style={[styles.calNavBtn, isToday && { opacity: 0.35 }]} disabled={isToday} onPress={() => shiftDay(1)}><Ionicons name="chevron-forward" size={18} color={colors.textPrimary} /></Pressable>
          </View>
          {selectedDate !== todayKey && <Pressable style={styles.jumpToday} onPress={() => guardedSetDate(todayKey)}><Text style={styles.jumpTodayText}>Jump to today</Text></Pressable>}
          {showDatePicker && <NativePicker mode="date" value={parseDateOnly(selectedDate)} maximumDate={new Date()} minimumDate={appData.settings.startDate ? parseDateOnly(appData.settings.startDate) : undefined} onCancel={() => setShowDatePicker(false)} onConfirm={(picked) => { setShowDatePicker(false); guardedSetDate(formatDateForInput(picked)); }} />}

          <Card>
            <Text style={styles.groupLabel}>Morning</Text>
            <View style={styles.timeRow}>
              <TimeField label="In" fieldKey="amTimeIn" value={workingEntry.amTimeIn} selectedDate={selectedDate} onChange={(v) => patchEntry({ amTimeIn: v })} />
              <TimeField label="Out" fieldKey="amTimeOut" value={workingEntry.amTimeOut} selectedDate={selectedDate} onChange={(v) => patchEntry({ amTimeOut: v })} />
            </View>
            <View style={styles.divider} />
            <Text style={styles.groupLabel}>Afternoon</Text>
            <View style={styles.timeRow}>
              <TimeField label="In" fieldKey="pmTimeIn" value={workingEntry.pmTimeIn} selectedDate={selectedDate} onChange={(v) => patchEntry({ pmTimeIn: v })} />
              <TimeField label="Out" fieldKey="pmTimeOut" value={workingEntry.pmTimeOut} selectedDate={selectedDate} onChange={(v) => patchEntry({ pmTimeOut: v })} />
            </View>
          </Card>

          <View style={styles.quickRow}>
            <Btn label="Fill 8–12, 1–5" variant="secondary" onPress={fillDefaultDay} style={{ flex: 1 }} />
            <Btn label="Clear times" variant="secondary" onPress={clearTimes} style={{ flex: 1 }} />
          </View>

          <Card>
            <View style={styles.totalRow}>
              <View>
                <Text style={styles.metaLabel}>Total today</Text>
                <Text style={styles.totalValue}>
                  {`${hours.toFixed(1)} h`}
                </Text>
              </View>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: renderDay ? colors.success : colors.warn }]} />
                <Text style={[styles.statusText, { color: renderDay ? colors.success : colors.warn }]}>{renderDay ? 'Render day' : 'Not a render day'}</Text>
              </View>
            </View>
          </Card>

          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, styles.textArea]} multiline value={workingEntry.notes} onChangeText={(text) => patchEntry({ notes: text })} placeholder="What did you work on? (optional)" placeholderTextColor={colors.neutral} />
          <View style={{ height: space.lg }} />
          <Btn label={dirty || !appData.entries[selectedDate] ? 'Save day' : 'Saved'} disabled={!dirty && !!appData.entries[selectedDate]} onPress={handleSaveCurrentEntry} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  };

  const renderCalendar = () => {
    const { year, month } = calendarMonth;
    const matrix = getMonthMatrix(year, month);
    let monthDaysLogged = 0;
    let monthHours = 0;
    for (const key of matrix) {
      if (!key) continue;
      const entry = appData.entries[key];
      if (entry) {
        const h = getDayHoursFromEntry(entry);
        if (h > 0) { monthDaysLogged += 1; monthHours += h; }
      }
    }
    const goPrev = () => month === 0 ? setCalendarMonth({ year: year - 1, month: 11 }) : setCalendarMonth({ year, month: month - 1 });
    const goNext = () => month === 11 ? setCalendarMonth({ year: year + 1, month: 0 }) : setCalendarMonth({ year, month: month + 1 });
    const goToday = () => { const now = new Date(); setCalendarMonth({ year: now.getFullYear(), month: now.getMonth() }); };

    const detailEntry = calendarDetailDate ? appData.entries[calendarDetailDate] : undefined;
    const detailHours = detailEntry ? getDayHoursFromEntry(detailEntry) : 0;
    const detailFuture = calendarDetailDate ? isFutureDate(calendarDetailDate, new Date()) : false;
    const detailBeforeStart = calendarDetailDate ? isBeforeStart(calendarDetailDate, appData.settings) : false;
    const detailRender = calendarDetailDate ? isRenderDay(calendarDetailDate, appData.settings) : false;
    const detailHolidayName = calendarDetailDate ? HOLIDAY_NAMES[calendarDetailDate] : undefined;
    const detailCustomExcluded = calendarDetailDate ? appData.settings.customExclusions.includes(calendarDetailDate) : false;
    const detailCustomName = calendarDetailDate ? appData.settings.customExclusionNames?.[calendarDetailDate] : undefined;

    const holidayBox = detailHolidayName ? (<View style={[styles.reasonBox, { backgroundColor: colors.dangerSoft }]}><Text style={[styles.reasonText, { color: colors.danger }]}>Holiday: {detailHolidayName}</Text></View>) : null;
    const excludedBox = detailCustomExcluded ? (<View style={[styles.reasonBox, { backgroundColor: EXCLUDED.bg }]}><Text style={[styles.reasonText, { color: EXCLUDED.fg }]}>Excluded{detailCustomName ? `: ${detailCustomName}` : ''}</Text></View>) : null;
    const beforeStartBox = detailBeforeStart ? (<View style={[styles.reasonBox, { backgroundColor: colors.neutralSoft }]}><Text style={[styles.reasonText, { color: colors.textSecondary }]}>Before your OJT start ({formatDateLabel(appData.settings.startDate)})</Text></View>) : null;

    return (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Calendar</Text>
        <Text style={styles.subtitle}>{monthDaysLogged} day{monthDaysLogged === 1 ? '' : 's'} logged · {monthHours.toFixed(1)}h this month</Text>
        <View style={styles.calHeader}>
          <Pressable accessibilityLabel="Previous month" style={styles.calNavBtn} onPress={goPrev}><Ionicons name="chevron-back" size={18} color={colors.textPrimary} /></Pressable>
          <Pressable onPress={goToday} accessibilityLabel="Jump to this month"><Text style={styles.calMonthLabel}>{MONTH_LABELS[month]} {year}</Text></Pressable>
          <Pressable accessibilityLabel="Next month" style={styles.calNavBtn} onPress={goNext}><Ionicons name="chevron-forward" size={18} color={colors.textPrimary} /></Pressable>
        </View>
        <View style={styles.calWeekRow}>{CALENDAR_HEADER.map((d, i) => <Text key={`${d}-${i}`} style={styles.calWeekLabel}>{d}</Text>)}</View>
        <View style={styles.calGrid}>
          {matrix.map((key, idx) => {
            if (!key) return <View key={`pad-${idx}`} style={styles.calCell} />;
            const entry = appData.entries[key];
            const h = entry ? getDayHoursFromEntry(entry) : 0;
            const hasHours = h > 0;
            const renderDay = isRenderDay(key, appData.settings);
            const isToday = key === todayKey;
            const isFuture = isFutureDate(key, new Date());
            const beforeStart = isBeforeStart(key, appData.settings);
            const missed = !hasHours && renderDay && !isFuture && !isToday && !beforeStart && !!appData.settings.startDate && key >= appData.settings.startDate;
            const isHoliday = appData.settings.holidays.includes(key);
            const isCustomExcluded = appData.settings.customExclusions.includes(key);
            return (
              <Pressable key={key} accessibilityLabel={`${formatLongDate(key)}${hasHours ? `, ${h.toFixed(1)} hours` : ''}${isHoliday ? ', holiday' : isCustomExcluded ? ', excluded' : ''}`} style={styles.calCell} onPress={() => setCalendarDetailDate(key)}>
                <View style={[styles.calCircle, hasHours && styles.calCircleLogged, missed && styles.calCircleMissed, !renderDay && !hasHours && styles.calCircleOff, isHoliday && !hasHours && styles.calCircleHoliday, isCustomExcluded && !hasHours && styles.calCircleExcluded, beforeStart && !hasHours && { opacity: 0.4 }, isToday && styles.calCircleToday]}>
                  <Text style={[styles.calDayNum, hasHours && styles.calDayNumLogged, missed && { color: colors.warn }, !renderDay && !hasHours && styles.calDayNumExcluded, isHoliday && !hasHours && { color: colors.danger, fontWeight: '600' }, isCustomExcluded && !hasHours && { color: EXCLUDED.fg, fontWeight: '600' }]}>
                    {Number(key.split('-')[2])}
                  </Text>
                  {hasHours ? <Text style={styles.calHours}>{h.toFixed(h % 1 === 0 ? 0 : 1)}h</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.primary }]} /><Text style={styles.legendText}>Logged</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.warn }]} /><Text style={styles.legendText}>Missed</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.danger }]} /><Text style={styles.legendText}>Holiday</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.borderStrong }]} /><Text style={styles.legendText}>Excluded</Text></View>
        </View>

        <Modal visible={!!calendarDetailDate} transparent animationType="slide" onRequestClose={() => setCalendarDetailDate(null)}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setCalendarDetailDate(null)} />
            {calendarDetailDate && (
              <View style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]}>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeaderRow}>
                  <Text style={styles.sheetTitle}>{formatLongDate(calendarDetailDate)}</Text>
                  <Pressable accessibilityLabel="Close" hitSlop={10} onPress={() => setCalendarDetailDate(null)}><Ionicons name="close" size={22} color={colors.textSecondary} /></Pressable>
                </View>
                {detailEntry && detailHours > 0 ? (
                  <>
                    <View style={styles.sheetGrid}>
                      <View style={styles.sheetItem}><Text style={styles.sheetLabel}>AM in</Text><Text style={styles.sheetValue}>{formatClock12(detailEntry.amTimeIn)}</Text></View>
                      <View style={styles.sheetItem}><Text style={styles.sheetLabel}>AM out</Text><Text style={styles.sheetValue}>{formatClock12(detailEntry.amTimeOut)}</Text></View>
                      <View style={styles.sheetItem}><Text style={styles.sheetLabel}>PM in</Text><Text style={styles.sheetValue}>{formatClock12(detailEntry.pmTimeIn)}</Text></View>
                      <View style={styles.sheetItem}><Text style={styles.sheetLabel}>PM out</Text><Text style={styles.sheetValue}>{formatClock12(detailEntry.pmTimeOut)}</Text></View>
                    </View>
                    <Text style={styles.sheetMeta}>Total <Text style={styles.helperStrong}>{detailHours.toFixed(1)}h</Text>  ·  {detailRender ? 'Render day' : 'Not a render day'}</Text>
                    {holidayBox}
                    {excludedBox}
                    {beforeStartBox}
                    {detailEntry.notes ? <View style={styles.notesBox}><Text style={styles.sheetLabel}>Notes</Text><Text style={styles.notesText}>{detailEntry.notes}</Text></View> : null}
                    <View style={styles.sheetActions}>
                      <Btn label="Edit" onPress={() => editFromCalendar(calendarDetailDate)} style={{ flex: 1 }} />
                      <Btn label="Delete" variant="danger" onPress={() => confirmDeleteEntry(calendarDetailDate)} style={{ flex: 1 }} />
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.helperText}>{detailFuture ? 'This day is in the future.' : 'Nothing logged on this day.'}</Text>
                    {holidayBox}
                    {excludedBox}
                    {beforeStartBox}
                    {!detailRender && !detailHolidayName && !detailCustomExcluded && !detailBeforeStart ? (<View style={[styles.reasonBox, { backgroundColor: colors.neutralSoft }]}><Text style={[styles.reasonText, { color: colors.textSecondary }]}>Not a workday (weekend or outside your OJT window)</Text></View>) : null}
                    <View style={styles.sheetActions}>
                      <Btn label="Log this day" disabled={detailFuture || detailBeforeStart} onPress={() => editFromCalendar(calendarDetailDate)} style={{ flex: 1 }} />
                      <Btn label="Close" variant="secondary" onPress={() => setCalendarDetailDate(null)} style={{ flex: 1 }} />
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        </Modal>
      </ScrollView>
    );
  };

  const renderSettings = () => (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Everything is kept offline on this device.</Text>
        <Card>
          <CardTitle title="Plan" />
          <NumberField label="Required hours" value={appData.settings.requiredHours || 486} min={1} max={5000} suffix="h" onCommit={(v) => updateSettings({ requiredHours: v })} />
          <NumberField label="Soft cap per day" value={appData.settings.maxHoursPerDay || 12} min={1} max={24} suffix="h" onCommit={(v) => updateSettings({ maxHoursPerDay: v })} />
          <DateField label="OJT start date" value={appData.settings.startDate} onChange={(v) => updateSettings({ startDate: v })} />
          <DateField label="Deadline & last render day" value={appData.settings.deadline} onChange={(v) => updateSettings({ deadline: v, lastRenderDay: v })} />
        </Card>
        <Card>
          <CardTitle title="Workdays" />
          {renderWorkdayChips()}
        </Card>
        <Card>
          <CardTitle title="Excluded dates" hint="Days that don't count toward your schedule." />

          <Text style={[styles.label, { marginTop: space.sm }]}>Built-in holidays</Text>
          <Text style={styles.inputHint}>Tap to remove if your company works on these days.</Text>
          <View style={styles.tagContainer}>
            {appData.settings.holidays.length === 0 ? (
              <Text style={styles.metaText}>No built-in holidays remaining.</Text>
            ) : (
              appData.settings.holidays.map((value) => (
                <Pressable key={value} accessibilityLabel={`Remove ${formatDateLabel(value)}`} style={[styles.tag, styles.tagMuted]}
                  onPress={() => {
                    Alert.alert('Remove built-in holiday?', `Are you sure you want to remove ${formatDateLabel(value)}? You will be expected to render on this day.`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => { updateSettings({ holidays: appData.settings.holidays.filter((d) => d !== value) }); } },
                    ]);
                  }}>
                  <Text style={[styles.tagText, styles.tagTextMuted]}>{formatDateLabel(value)}{HOLIDAY_NAMES[value] ? ` · ${HOLIDAY_NAMES[value]}` : ''}</Text>
                  <Ionicons name="close" size={13} color={colors.textSecondary} />
                </Pressable>
              ))
            )}
          </View>

          <View style={styles.divider} />

          <Text style={[styles.label, { marginTop: 0 }]}>Your custom exclusions</Text>
          {appData.settings.customExclusions.length === 0 ? (
            <Text style={styles.metaText}>No custom exclusions yet.</Text>
          ) : (
            <View style={styles.tagContainer}>
              {appData.settings.customExclusions.map((value) => (
                <Pressable key={value} accessibilityLabel={`Remove ${formatDateLabel(value)}`} style={styles.tag}
                  onPress={() => {
                    Alert.alert('Remove exclusion?', `Remove ${formatDateLabel(value)} from your excluded dates?`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove', style: 'destructive', onPress: () => {
                          const nextNames = { ...appData.settings.customExclusionNames };
                          delete nextNames[value];
                          updateSettings({ customExclusions: appData.settings.customExclusions.filter((item) => item !== value), customExclusionNames: nextNames });
                        }
                      },
                    ]);
                  }}>
                  <Text style={styles.tagText}>{formatDateLabel(value)}{appData.settings.customExclusionNames?.[value] ? ` · ${appData.settings.customExclusionNames[value]}` : ''}</Text>
                  <Ionicons name="close" size={13} color={colors.textPrimary} />
                </Pressable>
              ))}
            </View>
          )}

          <View style={{ marginTop: space.md }}>
            <AddExclusionButton
              onPick={(dateKey) => {
                if (appData.settings.customExclusions.includes(dateKey) || appData.settings.holidays.includes(dateKey)) {
                  Alert.alert('Already added', 'That date is already excluded.');
                  return;
                }
                setPendingExclusionDate(dateKey);
                setExclusionNameInput('');
                setShowExclusionModal(true);
              }}
            />
          </View>
        </Card>
        <Card>
          <CardTitle title="Daily reminder" hint="A local reminder at 6:00 PM to log your hours." />
          {reminderOn ? <Btn label="Turn off reminder" variant="secondary" onPress={disableReminder} /> : <Btn label="Remind me at 6:00 PM" onPress={enableReminder} />}
        </Card>
        <Card>
          <CardTitle title="Backup" hint={appData.lastExportedAt ? `Last exported ${formatDateLabel(String(appData.lastExportedAt).slice(0, 10))}.` : 'You have not exported a backup yet.'} />
          <Btn label="Export backup" onPress={handleBackupExport} />
          <View style={{ height: space.sm }} />
          <Btn label="Import backup" variant="secondary" onPress={handleBackupImport} />
        </Card>
        <Card>
          <CardTitle title="Danger zone" hint="Deletes every log and setting on this device." />
          <Btn label="Reset all data" variant="danger" onPress={confirmResetAll} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  if (isLoading) {
    return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}><Text style={styles.loadingText}>Loading…</Text></SafeAreaView>;
  }

  if (screen === 'onboarding') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{renderOnboarding()}</KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <View style={{ flex: 1 }}>
        {screen === 'dashboard' && renderDashboard()}
        {screen === 'daily-log' && renderDailyLog()}
        {screen === 'calendar' && renderCalendar()}
        {screen === 'settings' && renderSettings()}
        {toast ? (<View pointerEvents="none" style={[styles.toast, { bottom: space.lg }]}><Text style={styles.toastText}>{toast}</Text></View>) : null}
      </View>

      {!kbVisible && (
        <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
          {TABS.map((tab) => {
            const active = screen === tab.key;
            return (
              <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={tab.label} style={styles.tabItem} onPress={() => setScreen(tab.key)}>
                <Ionicons name={active ? tab.iconActive : tab.icon} size={22} color={active ? colors.primary : colors.neutral} />
                <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Modal visible={showExclusionModal} transparent animationType="fade" onRequestClose={() => setShowExclusionModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowExclusionModal(false)} />
            <View style={styles.pickerSheet}>
              <Text style={styles.sheetTitle}>Name this exclusion</Text>
              <Text style={[styles.inputHint, { marginTop: 6 }]}>Excluding {formatDateLabel(pendingExclusionDate)}. Why? (e.g. Typhoon, Company event)</Text>
              <TextInput style={[styles.input, { marginTop: space.md }]} value={exclusionNameInput} onChangeText={setExclusionNameInput} placeholder="e.g. Typhoon" placeholderTextColor={colors.neutral} autoFocus />
              <View style={[styles.sheetActions, { marginTop: space.lg }]}>
                <Btn label="Save" onPress={() => {
                  const nextNames = { ...appData.settings.customExclusionNames };
                  if (exclusionNameInput.trim()) { nextNames[pendingExclusionDate] = exclusionNameInput.trim(); }
                  updateSettings({ customExclusions: [...appData.settings.customExclusions, pendingExclusionDate].sort(), customExclusionNames: nextNames });
                  setShowExclusionModal(false);
                }} style={{ flex: 1 }} />
                <Btn label="Cancel" variant="secondary" onPress={() => setShowExclusionModal(false)} style={{ flex: 1 }} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showPasteImport} transparent animationType="slide" onRequestClose={() => setShowPasteImport(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowPasteImport(false)} />
            <View style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Paste your backup</Text>
              <Text style={[styles.inputHint, { marginTop: 6 }]}>Paste the whole backup text you exported. This replaces all data on this device.</Text>
              <TextInput style={[styles.input, styles.pasteInput]} multiline value={pasteText} onChangeText={setPasteText} placeholder="Paste backup text here" placeholderTextColor={colors.neutral} autoCorrect={false} autoCapitalize="none" />
              <View style={styles.sheetActions}>
                <Btn label="Restore" onPress={confirmPasteImport} style={{ flex: 1 }} />
                <Btn label="Cancel" variant="secondary" onPress={() => { setShowPasteImport(false); setPasteText(''); }} style={{ flex: 1 }} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const HAIR = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },

  // Tab bar
  tabBar: { flexDirection: 'row', backgroundColor: colors.card, paddingTop: 8, borderTopWidth: HAIR, borderTopColor: colors.border },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabText: { color: colors.neutral, fontWeight: '500', fontSize: 11 },
  tabTextActive: { color: colors.primary, fontWeight: '600' },

  // Layout / type
  content: { padding: space.lg, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.4, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: space.lg },
  subtitleTop: { fontSize: 13, color: colors.textSecondary, marginBottom: 2 },
  label: { fontSize: 13, color: colors.textPrimary, fontWeight: '600', marginTop: space.md, marginBottom: 6 },
  groupLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', marginBottom: space.sm },
  inputHint: { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },
  divider: { height: HAIR, backgroundColor: colors.border, marginVertical: space.md },

  // Inputs
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputSuffix: { color: colors.textSecondary, fontWeight: '500', fontSize: 15, width: 18 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11, color: colors.textPrimary, fontSize: 15 },
  inputButton: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputButtonText: { color: colors.textPrimary, fontWeight: '500', fontSize: 15 },
  textArea: { minHeight: 110, textAlignVertical: 'top' },
  pasteInput: { minHeight: 160, maxHeight: 260, textAlignVertical: 'top', marginTop: space.sm },

  // Buttons
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, minHeight: 48, paddingHorizontal: space.md },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderStrong },
  btnDanger: { backgroundColor: colors.card, borderWidth: 1, borderColor: '#E8C4C4' },
  btnText: { fontWeight: '600', fontSize: 15 },

  // Cards
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: HAIR, borderColor: colors.border, padding: space.lg, marginBottom: space.md },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },

  // Hero
  heroCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: HAIR, borderColor: colors.border, padding: space.lg, marginTop: space.md, marginBottom: space.md },
  heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroEyebrow: { color: colors.textSecondary, fontWeight: '500', fontSize: 13 },
  heroValue: { fontSize: 56, fontWeight: '600', color: colors.textPrimary, letterSpacing: -1.5, marginTop: 6, marginBottom: 4, fontVariant: ['tabular-nums'] },
  heroUnit: { fontSize: 22, fontWeight: '500', color: colors.textSecondary, letterSpacing: 0 },
  heroFooterRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  heroFooter: { color: colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.neutralSoft, overflow: 'hidden', marginTop: space.sm },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },

  // Status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '600' },

  // Today / overview
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  metaItem: { width: '50%', paddingVertical: 8 },
  metaLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: 2, fontWeight: '500' },
  metaValue: { color: colors.textPrimary, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  metaText: { color: colors.textSecondary, marginTop: space.sm, fontSize: 13 },
  helperText: { color: colors.textSecondary, marginTop: 4, fontSize: 14, lineHeight: 20 },
  helperStrong: { color: colors.textPrimary, fontWeight: '600' },
  warnText: { color: colors.warn, fontWeight: '600', fontSize: 15 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: HAIR, borderBottomColor: colors.border },
  kvLabel: { color: colors.textSecondary, fontSize: 14 },
  kvValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: space.md },

  // Chips
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontWeight: '600', fontSize: 12 },
  chipTextOn: { color: '#FFFFFF' },

  // Daily log
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginTop: space.sm, marginBottom: space.md },
  dateNavCenter: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  dateNavText: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  dateNavSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  jumpToday: { alignSelf: 'center', marginBottom: space.md, paddingVertical: 4 },
  jumpTodayText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  timeRow: { flexDirection: 'row', gap: space.sm },
  timeFieldWrap: { flex: 1 },
  fieldLabel: { fontWeight: '500', color: colors.textSecondary, marginBottom: 6, fontSize: 12 },
  timeButton: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  timeButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 16, fontVariant: ['tabular-nums'] },
  timeButtonTextSuggested: { color: colors.neutral, fontWeight: '500', fontSize: 15 },
  timeClear: { position: 'absolute', right: 10 },
  quickRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalValue: { fontSize: 30, fontWeight: '600', color: colors.textPrimary, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },

  // Calendar
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  calNavBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  calMonthLabel: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  calWeekRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekLabel: { flex: 1, textAlign: 'center', color: colors.textSecondary, fontWeight: '500', fontSize: 12 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: '14.2857%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  calCircle: { width: '100%', height: '100%', borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  calCircleLogged: { backgroundColor: colors.primary, borderColor: colors.primary },
  calCircleMissed: { backgroundColor: colors.warnSoft, borderColor: '#EBD3A8' },
  calCircleToday: { borderWidth: 1.5, borderColor: colors.primary },
  calCircleOff: { backgroundColor: 'transparent', borderColor: 'transparent' },
  calCircleHoliday: { backgroundColor: colors.dangerSoft, borderColor: '#EBC9C9' },
  calCircleExcluded: { backgroundColor: EXCLUDED.bg, borderColor: colors.border },
  calDayNum: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  calDayNumLogged: { color: '#FFFFFF', fontWeight: '600' },
  calDayNumExcluded: { color: colors.neutral, fontWeight: '400' },
  calHours: { fontSize: 9, fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginTop: 1 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 2 },
  legendText: { fontSize: 12, color: colors.textSecondary },

  // Sheets / modals
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(24,24,27,0.4)' },
  pickerSheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, paddingBottom: 32 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.sm },
  pickerCancel: { color: colors.textSecondary, fontWeight: '500', fontSize: 16 },
  pickerDone: { color: colors.primary, fontWeight: '600', fontSize: 16 },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: space.md },
  sheetHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  sheetTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
  sheetGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs },
  sheetItem: { width: '50%', paddingVertical: 6 },
  sheetLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: 2, fontWeight: '500' },
  sheetValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sheetMeta: { color: colors.textSecondary, marginTop: space.sm, fontSize: 14 },
  notesBox: { marginTop: space.sm, backgroundColor: colors.bg, borderRadius: radius.md, padding: space.md },
  notesText: { color: colors.textPrimary, marginTop: 4, lineHeight: 20 },
  sheetActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  reasonBox: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, marginTop: space.sm },
  reasonText: { fontWeight: '600', fontSize: 13 },

  // Tags
  tagContainer: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm, gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
  tagText: { color: colors.textPrimary, fontWeight: '500', fontSize: 13 },
  tagMuted: { backgroundColor: colors.neutralSoft, borderColor: colors.border },
  tagTextMuted: { color: colors.textSecondary },

  // Toast / loading
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: '#18181B', borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10 },
  toastText: { color: '#FFFFFF', fontWeight: '500', fontSize: 14 },
  loadingText: { fontSize: 15, textAlign: 'center', marginTop: 48, color: colors.textSecondary },
});