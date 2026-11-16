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
import { Ionicons } from '@expo/vector-icons';

import { buildEmptyData, HOLIDAY_NAMES } from './src/defaults';
import { AppData, DayEntry, Settings } from './src/types';
import {
  buildEntry,
  computeProjection,
  formatDateForInput,
  getDayHoursFromEntry,
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

// ---------- constants ----------

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

const TIME_SUGGESTIONS: Record<TimeFieldKey, { h: number; m: number }> = {
  amTimeIn: { h: 8, m: 0 },
  amTimeOut: { h: 12, m: 0 },
  pmTimeIn: { h: 13, m: 0 },
  pmTimeOut: { h: 17, m: 0 },
};

const ENTRY_FIELDS: (keyof DayEntry)[] = [
  'amTimeIn',
  'amTimeOut',
  'pmTimeIn',
  'pmTimeOut',
  'notes',
];

const REMINDER_ID = 'ojt-daily-reminder';
const REMINDER_CHANNEL = 'reminders';

const TABS: { key: Exclude<ScreenName, 'onboarding'>; label: string; icon: IconName; iconActive: IconName }[] = [
  { key: 'dashboard', label: 'Home', icon: 'speedometer-outline', iconActive: 'speedometer' },
  { key: 'daily-log', label: 'Log', icon: 'create-outline', iconActive: 'create' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline', iconActive: 'calendar' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', iconActive: 'settings' },
];

// ---------- helpers ----------

function isoAt(dateKey: string, hour: number, minute: number): string {
  const base = parseDateOnly(dateKey);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0).toISOString();
}

function makeLocalIsoFromTime(dateKey: string, time: Date): string {
  const base = parseDateOnly(dateKey);
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    time.getHours(),
    time.getMinutes(),
    0,
  ).toISOString();
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
  const startWeekday = first.getDay(); // Sun = 0, Mon = 1, ... Sat = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(formatDateForInput(new Date(year, month, d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ---------- small UI pieces ----------

type BtnProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

function Btn({ label, onPress, variant = 'primary', icon, disabled, style }: BtnProps) {
  const fg =
    variant === 'primary' ? '#FFFFFF' : variant === 'danger' ? colors.danger : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'danger' && styles.btnDanger,
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
      <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function CardTitle({ icon, title, hint }: { icon?: IconName; title: string; hint?: string }) {
  return (
    <View style={{ marginBottom: space.sm }}>
      <View style={styles.cardTitleRow}>
        {icon ? <Ionicons name={icon} size={18} color={colors.primary} /> : null}
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
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

type NumberFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
  onCommit: (value: number) => void;
};

function NumberField({ label, value, min, max, suffix, hint, onCommit }: NumberFieldProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(text.replace(/[^0-9.]/g, ''));
    if (!text.trim() || !Number.isFinite(n) || n < min) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, n);
    setText(String(clamped));
    onCommit(clamped);
  };

  return (
    <View style={{ marginTop: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          keyboardType="decimal-pad"
          value={text}
          onChangeText={setText}
          onBlur={commit}
          onEndEditing={commit}
          selectTextOnFocus
        />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
      {hint ? <Text style={styles.inputHint}>{hint}</Text> : null}
    </View>
  );
}

type NativePickerProps = {
  mode: 'date' | 'time';
  value: Date;
  maximumDate?: Date;
  minimumDate?: Date;
  onConfirm: (value: Date) => void;
  onCancel: () => void;
};

function NativePicker({ mode, value, maximumDate, minimumDate, onConfirm, onCancel }: NativePickerProps) {
  const [draft, setDraft] = useState(value);

  if (Platform.OS === 'android') {
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        display={mode === 'date' ? 'calendar' : 'spinner'}
        maximumDate={maximumDate}
        minimumDate={minimumDate}
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
            <Pressable onPress={onCancel} hitSlop={10}>
              <Text style={styles.pickerCancel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => onConfirm(draft)} hitSlop={10}>
              <Text style={styles.pickerDone}>Done</Text>
            </Pressable>
          </View>
          <DateTimePicker
            value={draft}
            mode={mode}
            display={mode === 'date' ? 'inline' : 'spinner'}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            onChange={(_event: DateTimePickerEvent, picked?: Date) => {
              if (picked) setDraft(picked);
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

type TimeFieldProps = {
  label: string;
  fieldKey: TimeFieldKey;
  value: string | null;
  selectedDate: string;
  onChange: (value: string | null) => void;
};

function TimeField({ label, fieldKey, value, selectedDate, onChange }: TimeFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  const suggestion = suggestionDate(selectedDate, fieldKey);
  const current = value ? new Date(value) : suggestion;
  const isSuggested = !value;

  return (
    <View style={styles.timeFieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} time`}
        style={[styles.timeButton, isSuggested && styles.timeButtonSuggested]}
        onPress={() => setShowPicker(true)}
      >
        <Text style={[styles.timeButtonText, isSuggested && styles.timeButtonTextSuggested]}>
          {isSuggested ? 'Set time' : formatClock12(value)}
        </Text>
        {value ? (
          <Pressable
            hitSlop={10}
            accessibilityLabel={`Clear ${label}`}
            onPress={() => onChange(null)}
            style={styles.timeClear}
          >
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </Pressable>
      {showPicker && (
        <NativePicker
          mode="time"
          value={current}
          onCancel={() => setShowPicker(false)}
          onConfirm={(picked) => {
            setShowPicker(false);
            onChange(makeLocalIsoFromTime(selectedDate, picked));
          }}
        />
      )}
    </View>
  );
}

type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maximumDate?: Date;
  minimumDate?: Date;
};

function DateField({ label, value, onChange, maximumDate, minimumDate }: DateFieldProps) {
  const [showPicker, setShowPicker] = useState(false);
  const current = value ? parseDateOnly(value) : new Date();

  return (
    <View style={{ marginTop: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        style={styles.inputButton}
        onPress={() => setShowPicker(true)}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        <Text
          style={[
            styles.inputButtonText,
            !value && { color: colors.textSecondary, fontWeight: '500' },
          ]}
        >
          {value ? formatLongDate(value) : 'Tap to pick a date'}
        </Text>
      </Pressable>
      {showPicker && (
        <NativePicker
          mode="date"
          value={current}
          maximumDate={maximumDate}
          minimumDate={minimumDate}
          onCancel={() => setShowPicker(false)}
          onConfirm={(picked) => {
            setShowPicker(false);
            onChange(formatDateForInput(picked));
          }}
        />
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
        <NativePicker
          mode="date"
          value={new Date()}
          onCancel={() => setShowPicker(false)}
          onConfirm={(picked) => {
            setShowPicker(false);
            onPick(formatDateForInput(picked));
          }}
        />
      )}
    </>
  );
}

// ---------- app ----------

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const insets = useSafeAreaInsets();

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
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const todayKey = formatDateForInput(new Date());

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKbVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
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
      } finally {
        setIsLoading(false);
      }
    };
    hydrate();
  }, []);

  useEffect(() => {
    if (!isLoading) {
      saveAppData(appData).catch(() => undefined);
    }
  }, [appData, isLoading]);

  useEffect(() => {
    const existing = appData.entries[selectedDate] || buildEntry(selectedDate);
    setFocusEntry(existing);
  }, [selectedDate, appData.entries]);

  const refreshReminderStatus = async () => {
    try {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      setReminderOn(all.some((n) => n.identifier === REMINDER_ID));
    } catch {
      setReminderOn(false);
    }
  };

  useEffect(() => {
    if (screen === 'settings') refreshReminderStatus();
  }, [screen]);

  const projection = useMemo(
    () => computeProjection(appData.settings, appData.entries, new Date()),
    [appData.entries, appData.settings],
  );

  const currentEntry = appData.entries[selectedDate] || buildEntry(selectedDate);
  const workingEntry = focusEntry || currentEntry;

  const dirty = ENTRY_FIELDS.some(
    (k) => (workingEntry[k] ?? '') !== (currentEntry[k] ?? ''),
  );

  const updateSettings = (changes: Partial<Settings>) => {
    setAppData((prev) => ({ ...prev, settings: { ...prev.settings, ...changes } }));
  };

  const patchEntry = (patch: Partial<DayEntry>) => {
    setFocusEntry((prev) => ({
      ...(prev || buildEntry(selectedDate)),
      date: selectedDate,
      ...patch,
      updatedAt: new Date().toISOString(),
      edited: true,
    }));
  };

  const guardedSetDate = (key: string, after?: () => void) => {
    if (key === selectedDate) {
      after?.();
      return;
    }
    if (isFutureDate(key, new Date())) {
      Alert.alert('Future date', 'You can only log today or earlier.');
      return;
    }
    const go = () => {
      setSelectedDate(key);
      after?.();
    };
    if (dirty) {
      Alert.alert('Discard changes?', 'You have unsaved changes for this day.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: go },
      ]);
    } else {
      go();
    }
  };

  const shiftDay = (delta: number) => {
    const d = parseDateOnly(selectedDate);
    d.setDate(d.getDate() + delta);
    guardedSetDate(formatDateForInput(d));
  };

  const persistEntry = (entry: DayEntry, now: string) => {
    setAppData((prev) => ({
      ...prev,
      entries: {
        ...prev.entries,
        [entry.date]: {
          ...entry,
          edited: entry.edited || !!prev.entries[entry.date],
          updatedAt: now,
        },
      },
    }));
    showToast(`Saved ${formatDateLabel(entry.date)}`);
    setScreen('dashboard');
  };

  const saveEntry = (entry: DayEntry) => {
    const now = new Date().toISOString();

    if (isFutureDate(entry.date, new Date())) {
      Alert.alert('Invalid date', 'Future dates are not allowed.');
      return;
    }

    const amIn = entry.amTimeIn ? new Date(entry.amTimeIn) : null;
    const amOut = entry.amTimeOut ? new Date(entry.amTimeOut) : null;
    const pmIn = entry.pmTimeIn ? new Date(entry.pmTimeIn) : null;
    const pmOut = entry.pmTimeOut ? new Date(entry.pmTimeOut) : null;

    if (!amIn && !amOut && !pmIn && !pmOut && !entry.notes?.trim()) {
      Alert.alert('Nothing to save', 'Set at least one time or add a note.');
      return;
    }
    if (amIn && amOut && amOut.getTime() <= amIn.getTime()) {
      Alert.alert('Check morning times', 'AM out must be later than AM in.');
      return;
    }
    if (pmIn && pmOut && pmOut.getTime() <= pmIn.getTime()) {
      Alert.alert('Check afternoon times', 'PM out must be later than PM in.');
      return;
    }
    const morningEnd = amOut || amIn;
    if (morningEnd && pmIn && pmIn.getTime() < morningEnd.getTime()) {
      Alert.alert('Check your times', 'PM in must be later than the morning times.');
      return;
    }

    const dayHours = getDayHoursFromEntry(entry);
    const warnings: string[] = [];
    if ((amIn && !amOut) || (!amIn && amOut)) {
      warnings.push('Morning has only one time, so it will not count toward your hours.');
    }
    if ((pmIn && !pmOut) || (!pmIn && pmOut)) {
      warnings.push('Afternoon has only one time, so it will not count toward your hours.');
    }
    if (dayHours > appData.settings.maxHoursPerDay) {
      warnings.push(
        `This day totals ${dayHours.toFixed(1)}h, above your ${appData.settings.maxHoursPerDay}h soft cap.`,
      );
    }
    if (dayHours > 0 && !isRenderDay(entry.date, appData.settings)) {
      warnings.push('This is not a render day (weekend, holiday, or excluded).');
    }

    if (warnings.length) {
      Alert.alert('Double-check this day', warnings.join('\n\n'), [
        { text: 'Edit', style: 'cancel' },
        { text: 'Save anyway', onPress: () => persistEntry(entry, now) },
      ]);
      return;
    }
    persistEntry(entry, now);
  };

  const handleSaveCurrentEntry = () => {
    saveEntry(focusEntry || { ...currentEntry, updatedAt: new Date().toISOString() });
  };

  const fillDefaultDay = () => {
    patchEntry({
      amTimeIn: isoAt(selectedDate, 8, 0),
      amTimeOut: isoAt(selectedDate, 12, 0),
      pmTimeIn: isoAt(selectedDate, 13, 0),
      pmTimeOut: isoAt(selectedDate, 17, 0),
    });
  };

  const clearTimes = () => {
    patchEntry({ amTimeIn: null, amTimeOut: null, pmTimeIn: null, pmTimeOut: null });
  };

  const handleCompletedOnboarding = () => {
    const s = appData.settings;
    if (!s.requiredHours || s.requiredHours <= 0) {
      Alert.alert('Required hours', 'Enter how many hours you need to render.');
      return;
    }
    if (!s.startDate || !s.deadline || !s.lastRenderDay) {
      Alert.alert('Missing dates', 'Pick your start date, deadline, and last render day.');
      return;
    }
    if (s.deadline < s.startDate || s.lastRenderDay < s.startDate) {
      Alert.alert('Check your dates', 'Deadline and last render day must be after your start date.');
      return;
    }
    if (!s.allowedWorkdays.some(Boolean)) {
      Alert.alert('Workdays', 'Turn on at least one workday.');
      return;
    }
    setAppData((prev) => ({ ...prev, hasCompletedOnboarding: true }));
    setScreen('dashboard');
  };

  const handleBackupExport = async () => {
    try {
      const text = await exportJsonBackup(appData);
      const result = await Share.share({
        title: 'OJT Tracker backup',
        message: `Backup file for OJT Tracker\n\n${text}`,
      });
      if (result.action === Share.sharedAction) {
        setAppData((prev) => ({ ...prev, lastExportedAt: new Date().toISOString() }));
        showToast('Backup exported');
      }
    } catch {
      Alert.alert('Export failed', 'Could not export the backup.');
    }
  };

  const runImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (result.canceled || !result.assets?.length) return;
      const response = await fetch(result.assets[0].uri);
      const text = await response.text();
      const imported = await importJsonBackup(text);
      setAppData(imported);
      showToast('Backup restored');
    } catch {
      Alert.alert('Import failed', 'The selected backup file could not be restored.');
    }
  };

  const handleBackupImport = () => {
    Alert.alert(
      'Replace current data?',
      'Importing a backup replaces everything on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose file', style: 'destructive', onPress: runImport },
      ],
    );
  };

  const enableReminder = async () => {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
          name: 'Daily reminder',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        const permission = await Notifications.requestPermissionsAsync();
        if (permission.status !== 'granted') {
          Alert.alert('Permission needed', 'Turn on notifications for this app in your phone settings.');
          return;
        }
      }
      await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => undefined);
      await Notifications.scheduleNotificationAsync({
        identifier: REMINDER_ID,
        content: {
          title: 'Still working?',
          body: 'Log your OJT hours before you finish the day.',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: 18,
          minute: 0,
          channelId: REMINDER_CHANNEL,
        },
      });
      setReminderOn(true);
      showToast('Daily reminder set for 6:00 PM');
    } catch {
      Alert.alert('Reminder failed', 'Could not schedule the reminder on this device.');
    }
  };

  const disableReminder = async () => {
    try {
      await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
    } catch {
      // ignore
    }
    setReminderOn(false);
    showToast('Reminder turned off');
  };

  const removeCustomExclusion = (value: string) => {
    updateSettings({
      customExclusions: appData.settings.customExclusions.filter((item) => item !== value),
    });
  };

  const deleteEntry = (dateKey: string) => {
    setAppData((prev) => {
      const next = { ...prev.entries };
      delete next[dateKey];
      return { ...prev, entries: next };
    });
  };

  const confirmDeleteEntry = (dateKey: string) => {
    Alert.alert(
      'Delete this log?',
      `Remove all hours logged on ${formatDateLabel(dateKey)}? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteEntry(dateKey);
            setCalendarDetailDate(null);
            showToast('Log deleted');
          },
        },
      ],
    );
  };

  const confirmResetAll = () => {
    Alert.alert(
      'Reset all data?',
      'This deletes every log and setting on this device. Export a backup first if you need one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset everything',
          style: 'destructive',
          onPress: async () => {
            await disableReminder();
            setAppData((prev) => ({ ...buildEmptyData(), lastExportedAt: prev.lastExportedAt }));
            setScreen('onboarding');
          },
        },
      ],
    );
  };

  const editFromCalendar = (dateKey: string) => {
    guardedSetDate(dateKey, () => {
      setCalendarDetailDate(null);
      setScreen('daily-log');
    });
  };

  const pill =
    projection.status === 'complete'
      ? { bg: colors.successSoft, fg: colors.success, label: 'Complete' }
      : projection.status === 'on-track'
        ? { bg: colors.successSoft, fg: colors.success, label: 'On track' }
        : projection.status === 'behind'
          ? { bg: colors.dangerSoft, fg: colors.danger, label: 'Behind' }
          : { bg: colors.warnSoft, fg: colors.warn, label: 'Needs data' };

  const progressPct = appData.settings.requiredHours
    ? Math.min(100, (projection.totalHoursRendered / appData.settings.requiredHours) * 100)
    : 0;

  // ---------- screens ----------

  const renderWorkdayChips = () => (
    <View style={styles.chipRow}>
      {DAY_LABELS.map((day, index) => {
        const on = appData.settings.allowedWorkdays[index];
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            accessibilityLabel={`${day} ${on ? 'on' : 'off'}`}
            style={[styles.chip, on && styles.chipOn]}
            onPress={() => {
              const next = [...appData.settings.allowedWorkdays];
              next[index] = !next[index];
              updateSettings({ allowedWorkdays: next });
            }}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{day}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  const renderOnboarding = () => (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Set up your OJT plan</Text>
      <Text style={styles.subtitle}>
        Your data stays on this phone. Nothing is uploaded.
      </Text>

      <Card>
        <CardTitle icon="time-outline" title="Hours" />
        <NumberField
          label="Required hours"
          value={appData.settings.requiredHours || 486}
          min={1}
          max={5000}
          suffix="h"
          onCommit={(v) => updateSettings({ requiredHours: v })}
        />
        <NumberField
          label="Soft cap per day"
          value={appData.settings.maxHoursPerDay || 12}
          min={1}
          max={24}
          suffix="h"
          hint="We ask you to double-check any day above this."
          onCommit={(v) => updateSettings({ maxHoursPerDay: v })}
        />
      </Card>

      <Card>
        <CardTitle icon="calendar-outline" title="Dates" />
        <DateField
          label="OJT start date"
          value={appData.settings.startDate}
          onChange={(v) => updateSettings({ startDate: v })}
        />
        <DateField
          label="Deadline"
          value={appData.settings.deadline}
          minimumDate={appData.settings.startDate ? parseDateOnly(appData.settings.startDate) : undefined}
          onChange={(v) => updateSettings({ deadline: v })}
        />
        <DateField
          label="Last render day"
          value={appData.settings.lastRenderDay}
          minimumDate={appData.settings.startDate ? parseDateOnly(appData.settings.startDate) : undefined}
          onChange={(v) => updateSettings({ lastRenderDay: v })}
        />
      </Card>

      <Card>
        <CardTitle icon="briefcase-outline" title="Workdays" hint="Tap the days you report for OJT." />
        {renderWorkdayChips()}
      </Card>

      <Btn label="Continue to dashboard" icon="arrow-forward" onPress={handleCompletedOnboarding} />
    </ScrollView>
  );

  const renderDashboard = () => {
    const todayEntry = appData.entries[todayKey];
    const todayHours = todayEntry ? getDayHoursFromEntry(todayEntry) : 0;
    const deadline = appData.settings.deadline;
    const daysToDeadline = deadline
      ? Math.ceil(
        (parseDateOnly(deadline).getTime() - parseDateOnly(todayKey).getTime()) / 86400000,
      )
      : null;
    const buffer = Number(projection.bufferOrDeficit);
    const bufferText = Number.isFinite(buffer)
      ? buffer >= 0
        ? `${buffer} workday${buffer === 1 ? '' : 's'} to spare`
        : `${Math.abs(buffer)} workday${Math.abs(buffer) === 1 ? '' : 's'} short`
      : '—';

    return (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>OJT Tracker</Text>
        <Text style={styles.subtitle}>{formatLongDate(todayKey)}</Text>

        <View style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <Text style={styles.heroEyebrow}>Hours needed per day</Text>
            <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
              <Text style={[styles.statusPillText, { color: pill.fg }]}>{pill.label}</Text>
            </View>
          </View>
          <Text style={styles.heroValue}>
            {projection.hoursPerDayNeeded.toFixed(1)}
            <Text style={styles.heroUnit}>h</Text>
          </Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
          </View>
          <Text style={styles.heroFooter}>
            {projection.totalHoursRendered.toFixed(1)}h of {appData.settings.requiredHours}h rendered
            {'  ·  '}
            {progressPct.toFixed(0)}%
          </Text>
        </View>

        <Card>
          <View style={styles.todayRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Today</Text>
              <Text style={styles.helperText}>
                {todayHours > 0
                  ? `${todayHours.toFixed(1)}h logged`
                  : isRenderDay(todayKey, appData.settings)
                    ? 'Nothing logged yet'
                    : 'Not a render day'}
              </Text>
            </View>
            <Btn
              label={todayHours > 0 ? 'Edit today' : 'Log today'}
              icon={todayHours > 0 ? 'create-outline' : 'add'}
              onPress={() => guardedSetDate(todayKey, () => setScreen('daily-log'))}
              style={{ paddingHorizontal: space.lg }}
            />
          </View>
        </Card>

        <Card>
          <CardTitle icon="stats-chart-outline" title="Overview" />
          <View style={styles.metaGrid}>
            <Stat label="Working days left" value={String(projection.workingDaysLeft)} />
            <Stat label="Hours remaining" value={`${projection.hoursRemaining.toFixed(1)}h`} />
            <Stat
              label="Average per day"
              value={projection.avgPerWorkday ? `${projection.avgPerWorkday.toFixed(1)}h` : '—'}
            />
            <Stat label="Days logged" value={String(projection.workdaysRendered)} />
            <Stat
              label="Days to deadline"
              value={
                daysToDeadline === null
                  ? '—'
                  : daysToDeadline < 0
                    ? 'Past due'
                    : String(daysToDeadline)
              }
            />
          </View>
        </Card>

        <Card>
          <CardTitle icon="trending-up-outline" title="Projection" />
          {projection.status === 'not-enough-data' ? (
            <View>
              <Text style={styles.warnText}>Log your first day to see your projection</Text>
              <Text style={styles.helperText}>
                We'll estimate your finish date and whether you'll hit{' '}
                {formatDateLabel(appData.settings.lastRenderDay)}.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.helperText}>
                Projected finish:{' '}
                <Text style={styles.helperStrong}>
                  {projection.projectedFinish ? formatDateLabel(projection.projectedFinish) : '—'}
                </Text>
              </Text>
              <Text style={styles.helperText}>
                Pace: <Text style={styles.helperStrong}>{bufferText}</Text>
              </Text>
              <Text style={styles.helperText}>
                Last render day: {formatDateLabel(appData.settings.lastRenderDay)} · Deadline:{' '}
                {formatDateLabel(appData.settings.deadline)}
              </Text>
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Daily log</Text>

          <View style={styles.dateNav}>
            <Pressable
              accessibilityLabel="Previous day"
              style={styles.calNavBtn}
              onPress={() => shiftDay(-1)}
            >
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
            </Pressable>
            <Pressable
              accessibilityLabel="Pick a date"
              style={styles.dateNavCenter}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={styles.dateNavText}>{formatLongDate(selectedDate)}</Text>
              <Text style={styles.dateNavSub}>
                {selectedDate === todayKey ? 'Today · tap to change' : 'Tap to change'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Next day"
              style={[styles.calNavBtn, isToday && { opacity: 0.35 }]}
              disabled={isToday}
              onPress={() => shiftDay(1)}
            >
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </Pressable>
          </View>

          {selectedDate !== todayKey && (
            <Pressable style={styles.jumpToday} onPress={() => guardedSetDate(todayKey)}>
              <Text style={styles.jumpTodayText}>Jump to today</Text>
            </Pressable>
          )}

          {showDatePicker && (
            <NativePicker
              mode="date"
              value={parseDateOnly(selectedDate)}
              maximumDate={new Date()}
              onCancel={() => setShowDatePicker(false)}
              onConfirm={(picked) => {
                setShowDatePicker(false);
                guardedSetDate(formatDateForInput(picked));
              }}
            />
          )}

          <Card>
            <CardTitle icon="sunny-outline" title="Morning" />
            <View style={styles.timeRow}>
              <TimeField
                label="In"
                fieldKey="amTimeIn"
                value={workingEntry.amTimeIn}
                selectedDate={selectedDate}
                onChange={(v) => patchEntry({ amTimeIn: v })}
              />
              <TimeField
                label="Out"
                fieldKey="amTimeOut"
                value={workingEntry.amTimeOut}
                selectedDate={selectedDate}
                onChange={(v) => patchEntry({ amTimeOut: v })}
              />
            </View>
          </Card>

          <Card>
            <CardTitle icon="partly-sunny-outline" title="Afternoon" />
            <View style={styles.timeRow}>
              <TimeField
                label="In"
                fieldKey="pmTimeIn"
                value={workingEntry.pmTimeIn}
                selectedDate={selectedDate}
                onChange={(v) => patchEntry({ pmTimeIn: v })}
              />
              <TimeField
                label="Out"
                fieldKey="pmTimeOut"
                value={workingEntry.pmTimeOut}
                selectedDate={selectedDate}
                onChange={(v) => patchEntry({ pmTimeOut: v })}
              />
            </View>
          </Card>

          <View style={styles.quickRow}>
            <Btn
              label="Fill 8–12, 1–5"
              icon="flash-outline"
              variant="secondary"
              onPress={fillDefaultDay}
              style={{ flex: 1 }}
            />
            <Btn
              label="Clear times"
              icon="trash-outline"
              variant="secondary"
              onPress={clearTimes}
              style={{ flex: 1 }}
            />
          </View>

          <Card>
            <View style={styles.totalRow}>
              <View>
                <Text style={styles.metaLabel}>Total today</Text>
                <Text style={styles.totalValue}>{hours.toFixed(1)}h</Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: renderDay ? colors.successSoft : colors.warnSoft },
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    { color: renderDay ? colors.success : colors.warn },
                  ]}
                >
                  {renderDay ? 'Render day' : 'Not a render day'}
                </Text>
              </View>
            </View>
          </Card>

          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            multiline
            value={workingEntry.notes}
            onChangeText={(text) => patchEntry({ notes: text })}
            placeholder="What did you work on? (optional)"
            placeholderTextColor={colors.textSecondary}
          />

          <View style={{ height: space.lg }} />
          <Btn
            label={dirty || !appData.entries[selectedDate] ? 'Save day' : 'Saved'}
            icon="checkmark"
            disabled={!dirty && !!appData.entries[selectedDate]}
            onPress={handleSaveCurrentEntry}
          />
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
        if (h > 0) {
          monthDaysLogged += 1;
          monthHours += h;
        }
      }
    }

    const goPrev = () =>
      month === 0
        ? setCalendarMonth({ year: year - 1, month: 11 })
        : setCalendarMonth({ year, month: month - 1 });
    const goNext = () =>
      month === 11
        ? setCalendarMonth({ year: year + 1, month: 0 })
        : setCalendarMonth({ year, month: month + 1 });
    const goToday = () => {
      const now = new Date();
      setCalendarMonth({ year: now.getFullYear(), month: now.getMonth() });
    };

    const detailEntry = calendarDetailDate ? appData.entries[calendarDetailDate] : undefined;
    const detailHours = detailEntry ? getDayHoursFromEntry(detailEntry) : 0;
    const detailFuture = calendarDetailDate ? isFutureDate(calendarDetailDate, new Date()) : false;
    const detailRender = calendarDetailDate
      ? isRenderDay(calendarDetailDate, appData.settings)
      : false;
    const detailHolidayName = calendarDetailDate ? HOLIDAY_NAMES[calendarDetailDate] : undefined;
    const detailCustomExcluded = calendarDetailDate
      ? appData.settings.customExclusions.includes(calendarDetailDate)
      : false;

    return (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Calendar</Text>
        <Text style={styles.subtitle}>
          {monthDaysLogged} day{monthDaysLogged === 1 ? '' : 's'} logged · {monthHours.toFixed(1)}h
          this month
        </Text>

        <View style={styles.calHeader}>
          <Pressable accessibilityLabel="Previous month" style={styles.calNavBtn} onPress={goPrev}>
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
          </Pressable>
          <Pressable onPress={goToday} accessibilityLabel="Jump to this month">
            <Text style={styles.calMonthLabel}>
              {MONTH_LABELS[month]} {year}
            </Text>
          </Pressable>
          <Pressable accessibilityLabel="Next month" style={styles.calNavBtn} onPress={goNext}>
            <Ionicons name="chevron-forward" size={20} color={colors.primary} />
          </Pressable>
        </View>

        <View style={styles.calWeekRow}>
          {CALENDAR_HEADER.map((d, i) => (
            <Text key={`${d}-${i}`} style={styles.calWeekLabel}>
              {d}
            </Text>
          ))}
        </View>

        <View style={styles.calGrid}>
          {matrix.map((key, idx) => {
            if (!key) return <View key={`pad-${idx}`} style={styles.calCell} />;
            const entry = appData.entries[key];
            const h = entry ? getDayHoursFromEntry(entry) : 0;
            const hasHours = h > 0;
            const renderDay = isRenderDay(key, appData.settings);
            const isToday = key === todayKey;
            const isFuture = isFutureDate(key, new Date());
            const missed =
              !hasHours &&
              renderDay &&
              !isFuture &&
              !isToday &&
              !!appData.settings.startDate &&
              key >= appData.settings.startDate;
            const isHoliday = appData.settings.holidays.includes(key);
            const isCustomExcluded = appData.settings.customExclusions.includes(key);

            return (
              <Pressable
                key={key}
                accessibilityLabel={`${formatLongDate(key)}${hasHours ? `, ${h.toFixed(1)} hours` : ''}${isHoliday ? ', holiday' : isCustomExcluded ? ', excluded' : ''
                  }`}
                style={styles.calCell}
                onPress={() => setCalendarDetailDate(key)}
              >
                <View
                  style={[
                    styles.calCircle,
                    hasHours && styles.calCircleLogged,
                    missed && styles.calCircleMissed,
                    isToday && styles.calCircleToday,
                    !renderDay && !hasHours && styles.calCircleOff,
                    isHoliday && !hasHours && styles.calCircleHoliday,
                    isCustomExcluded && !hasHours && styles.calCircleExcluded,
                  ]}
                >
                  <Text
                    style={[
                      styles.calDayNum,
                      hasHours && styles.calDayNumLogged,
                      missed && { color: colors.warn },
                      !renderDay && !hasHours && styles.calDayNumExcluded,
                      isHoliday && !hasHours && { color: colors.danger, fontWeight: '800' },
                      isCustomExcluded && !hasHours && { color: colors.warn, fontWeight: '800' },
                    ]}
                  >
                    {Number(key.split('-')[2])}
                  </Text>
                  {hasHours ? (
                    <Text style={styles.calHours}>{h.toFixed(h % 1 === 0 ? 0 : 1)}h</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.legendText}>Logged</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.warn }]} />
            <Text style={styles.legendText}>Missed</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
            <Text style={styles.legendText}>Holiday</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.warn }]} />
            <Text style={styles.legendText}>Excluded</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#CBD5E1' }]} />
            <Text style={styles.legendText}>Off</Text>
          </View>
        </View>

        <Modal
          visible={!!calendarDetailDate}
          transparent
          animationType="slide"
          onRequestClose={() => setCalendarDetailDate(null)}
        >
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setCalendarDetailDate(null)} />
            {calendarDetailDate && (
              <View style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]}>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeaderRow}>
                  <Text style={styles.sheetTitle}>{formatLongDate(calendarDetailDate)}</Text>
                  <Pressable
                    accessibilityLabel="Close"
                    hitSlop={10}
                    onPress={() => setCalendarDetailDate(null)}
                  >
                    <Ionicons name="close" size={22} color={colors.textSecondary} />
                  </Pressable>
                </View>

                {detailEntry && detailHours > 0 ? (
                  <>
                    <View style={styles.sheetGrid}>
                      <View style={styles.sheetItem}>
                        <Text style={styles.sheetLabel}>AM in</Text>
                        <Text style={styles.sheetValue}>{formatClock12(detailEntry.amTimeIn)}</Text>
                      </View>
                      <View style={styles.sheetItem}>
                        <Text style={styles.sheetLabel}>AM out</Text>
                        <Text style={styles.sheetValue}>{formatClock12(detailEntry.amTimeOut)}</Text>
                      </View>
                      <View style={styles.sheetItem}>
                        <Text style={styles.sheetLabel}>PM in</Text>
                        <Text style={styles.sheetValue}>{formatClock12(detailEntry.pmTimeIn)}</Text>
                      </View>
                      <View style={styles.sheetItem}>
                        <Text style={styles.sheetLabel}>PM out</Text>
                        <Text style={styles.sheetValue}>{formatClock12(detailEntry.pmTimeOut)}</Text>
                      </View>
                    </View>

                    <Text style={styles.sheetMeta}>
                      Total: <Text style={styles.helperStrong}>{detailHours.toFixed(1)}h</Text>
                      {'  ·  '}
                      {detailRender ? 'Render day' : 'Not a render day'}
                    </Text>

                    {detailHolidayName ? (
                      <View style={[styles.reasonBox, { backgroundColor: colors.dangerSoft }]}>
                        <Ionicons name="flag-outline" size={16} color={colors.danger} />
                        <Text style={[styles.reasonText, { color: colors.danger }]}>
                          Holiday: {detailHolidayName}
                        </Text>
                      </View>
                    ) : null}
                    {detailCustomExcluded ? (
                      <View style={[styles.reasonBox, { backgroundColor: colors.warnSoft }]}>
                        <Ionicons name="ban-outline" size={16} color={colors.warn} />
                        <Text style={[styles.reasonText, { color: colors.warn }]}>
                          Excluded date (you added this)
                        </Text>
                      </View>
                    ) : null}

                    {detailEntry.notes ? (
                      <View style={styles.notesBox}>
                        <Text style={styles.sheetLabel}>Notes</Text>
                        <Text style={styles.notesText}>{detailEntry.notes}</Text>
                      </View>
                    ) : null}

                    <View style={styles.sheetActions}>
                      <Btn
                        label="Edit"
                        icon="create-outline"
                        onPress={() => editFromCalendar(calendarDetailDate)}
                        style={{ flex: 1 }}
                      />
                      <Btn
                        label="Delete"
                        icon="trash-outline"
                        variant="danger"
                        onPress={() => confirmDeleteEntry(calendarDetailDate)}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.helperText}>
                      {detailFuture ? 'This day is in the future.' : 'Nothing logged on this day.'}
                    </Text>
                    {detailHolidayName ? (
                      <View style={[styles.reasonBox, { backgroundColor: colors.dangerSoft }]}>
                        <Ionicons name="flag-outline" size={16} color={colors.danger} />
                        <Text style={[styles.reasonText, { color: colors.danger }]}>
                          Holiday: {detailHolidayName}
                        </Text>
                      </View>
                    ) : null}
                    {detailCustomExcluded ? (
                      <View style={[styles.reasonBox, { backgroundColor: colors.warnSoft }]}>
                        <Ionicons name="ban-outline" size={16} color={colors.warn} />
                        <Text style={[styles.reasonText, { color: colors.warn }]}>
                          Excluded date (you added this)
                        </Text>
                      </View>
                    ) : null}
                    {!detailRender && !detailHolidayName && !detailCustomExcluded ? (
                      <View style={[styles.reasonBox, { backgroundColor: '#F1F5F9' }]}>
                        <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
                        <Text style={[styles.reasonText, { color: colors.textSecondary }]}>
                          Not a workday (weekend or outside your OJT window)
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.sheetActions}>
                      <Btn
                        label="Log this day"
                        icon="add"
                        disabled={detailFuture}
                        onPress={() => editFromCalendar(calendarDetailDate)}
                        style={{ flex: 1 }}
                      />
                      <Btn
                        label="Close"
                        variant="secondary"
                        onPress={() => setCalendarDetailDate(null)}
                        style={{ flex: 1 }}
                      />
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
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Everything is kept offline on this device.</Text>

        <Card>
          <CardTitle icon="time-outline" title="Plan" />
          <NumberField
            label="Required hours"
            value={appData.settings.requiredHours || 486}
            min={1}
            max={5000}
            suffix="h"
            onCommit={(v) => updateSettings({ requiredHours: v })}
          />
          <NumberField
            label="Soft cap per day"
            value={appData.settings.maxHoursPerDay || 12}
            min={1}
            max={24}
            suffix="h"
            onCommit={(v) => updateSettings({ maxHoursPerDay: v })}
          />
          <DateField
            label="OJT start date"
            value={appData.settings.startDate}
            onChange={(v) => updateSettings({ startDate: v })}
          />
          <DateField
            label="Deadline"
            value={appData.settings.deadline}
            onChange={(v) => updateSettings({ deadline: v })}
          />
          <DateField
            label="Last render day"
            value={appData.settings.lastRenderDay}
            onChange={(v) => updateSettings({ lastRenderDay: v })}
          />
        </Card>

        <Card>
          <CardTitle icon="briefcase-outline" title="Workdays" />
          {renderWorkdayChips()}
        </Card>

        <Card>
          <CardTitle
            icon="ban-outline"
            title="Excluded dates"
            hint="Typhoon, suspension, or any day you won't render."
          />
          <AddExclusionButton
            onPick={(dateKey) => {
              if (appData.settings.customExclusions.includes(dateKey)) {
                Alert.alert('Already added', 'That date is already excluded.');
                return;
              }
              updateSettings({
                customExclusions: [...appData.settings.customExclusions, dateKey].sort(),
              });
            }}
          />
          {appData.settings.customExclusions.length === 0 ? (
            <Text style={styles.metaText}>No excluded dates yet.</Text>
          ) : (
            <View style={styles.tagContainer}>
              {appData.settings.customExclusions.map((value) => (
                <Pressable
                  key={value}
                  accessibilityLabel={`Remove ${formatDateLabel(value)}`}
                  style={styles.tag}
                  onPress={() => removeCustomExclusion(value)}
                >
                  <Text style={styles.tagText}>{formatDateLabel(value)}</Text>
                  <Ionicons name="close" size={14} color={colors.textPrimary} />
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.label, { marginTop: space.lg }]}>Built-in holidays</Text>
          <Text style={styles.inputHint}>
            From the PH holiday list. These are excluded automatically.
          </Text>
          <View style={styles.tagContainer}>
            {appData.settings.holidays.length === 0 ? (
              <Text style={styles.metaText}>No holidays in the current window.</Text>
            ) : (
              appData.settings.holidays.map((value) => (
                <View key={value} style={[styles.tag, styles.tagMuted]}>
                  <Text style={[styles.tagText, styles.tagTextMuted]}>
                    {HOLIDAY_NAMES[value] ? `${formatDateLabel(value)} · ${HOLIDAY_NAMES[value]}` : formatDateLabel(value)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </Card>

        <Card>
          <CardTitle
            icon="notifications-outline"
            title="Daily reminder"
            hint="A local reminder at 6:00 PM to log your hours."
          />
          {reminderOn ? (
            <Btn label="Turn off reminder" icon="notifications-off-outline" variant="secondary" onPress={disableReminder} />
          ) : (
            <Btn label="Remind me at 6:00 PM" icon="notifications-outline" onPress={enableReminder} />
          )}
        </Card>

        <Card>
          <CardTitle
            icon="cloud-upload-outline"
            title="Backup"
            hint={
              appData.lastExportedAt
                ? `Last exported ${formatDateLabel(String(appData.lastExportedAt).slice(0, 10))}`
                : 'You have not exported a backup yet.'
            }
          />
          <Btn label="Export backup" icon="share-outline" onPress={handleBackupExport} />
          <View style={{ height: space.sm }} />
          <Btn label="Import backup" icon="download-outline" variant="secondary" onPress={handleBackupImport} />
        </Card>

        <Card>
          <CardTitle icon="warning-outline" title="Danger zone" />
          <Btn label="Reset all data" icon="refresh" variant="danger" onPress={confirmResetAll} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <Text style={styles.loadingText}>Loading OJT Tracker…</Text>
      </SafeAreaView>
    );
  }

  if (screen === 'onboarding') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {renderOnboarding()}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={{ flex: 1 }}>
        {screen === 'dashboard' && renderDashboard()}
        {screen === 'daily-log' && renderDailyLog()}
        {screen === 'calendar' && renderCalendar()}
        {screen === 'settings' && renderSettings()}

        {toast ? (
          <View
            pointerEvents="none"
            style={[styles.toast, { bottom: kbVisible ? space.lg : space.lg }]}
          >
            <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}
      </View>

      {!kbVisible && (
        <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
          {TABS.map((tab) => {
            const active = screen === tab.key;
            return (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={tab.label}
                style={styles.tabItem}
                onPress={() => setScreen(tab.key)}
              >
                <View style={[styles.tabIconWrap, active && styles.tabIconWrapActive]}>
                  <Ionicons
                    name={active ? tab.iconActive : tab.icon}
                    size={22}
                    color={active ? colors.primary : colors.textSecondary}
                  />
                </View>
                <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------- styles ----------

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
  },
  tabItem: { flex: 1, alignItems: 'center' },
  tabIconWrap: {
    paddingHorizontal: 18,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  tabIconWrapActive: { backgroundColor: colors.primarySoft },
  tabText: { color: colors.textSecondary, fontWeight: '600', fontSize: 11, marginTop: 2 },
  tabTextActive: { color: colors.primary, fontWeight: '800' },

  content: { padding: space.lg, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '800', color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: space.lg },
  label: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '700',
    marginTop: space.md,
    marginBottom: space.sm,
  },
  inputHint: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputSuffix: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 15,
  },
  inputButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
  textArea: { minHeight: 110, textAlignVertical: 'top' },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: space.md,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.primarySoft },
  btnDanger: { backgroundColor: colors.dangerSoft },
  btnText: { fontWeight: '800', fontSize: 15 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    shadowColor: '#0A2540',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },

  heroCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    shadowColor: '#0A2540',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  heroEyebrow: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  heroValue: { fontSize: 52, fontWeight: '800', color: colors.textPrimary, marginVertical: 4 },
  heroUnit: { fontSize: 24, fontWeight: '700', color: colors.textSecondary },
  heroFooter: { color: colors.textSecondary, marginTop: space.sm, fontSize: 13 },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  statusPillText: { fontSize: 12, fontWeight: '800' },

  progressTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: '#EEF2F7',
    overflow: 'hidden',
    marginTop: space.sm,
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.pill },

  todayRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs },
  metaItem: { width: '50%', paddingVertical: 8 },
  metaLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: 2, fontWeight: '600' },
  metaValue: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  metaText: { color: colors.textSecondary, marginTop: space.sm },

  helperText: { color: colors.textSecondary, marginTop: 6, fontSize: 14, lineHeight: 20 },
  helperStrong: { color: colors.textPrimary, fontWeight: '700' },
  warnText: { color: colors.warn, fontWeight: '800', fontSize: 16 },

  chipRow: { flexDirection: 'row', gap: 6 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: '#F3F4F6',
  },
  chipOn: { backgroundColor: colors.primary },
  chipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 12 },
  chipTextOn: { color: '#FFFFFF' },

  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.sm,
    marginBottom: space.md,
  },
  dateNavCenter: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  dateNavText: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  dateNavSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  jumpToday: { alignSelf: 'center', marginBottom: space.md, paddingVertical: 4 },
  jumpTodayText: { color: colors.primary, fontWeight: '700' },

  timeRow: { flexDirection: 'row', gap: space.sm },
  timeFieldWrap: { flex: 1 },
  fieldLabel: { fontWeight: '700', color: colors.textSecondary, marginBottom: 6, fontSize: 13 },
  timeButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  timeButtonSuggested: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
  },
  timeButtonText: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
  timeButtonTextSuggested: { color: colors.primary, fontSize: 14 },
  timeClear: { position: 'absolute', right: 8 },
  quickRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalValue: { fontSize: 30, fontWeight: '800', color: colors.textPrimary },

  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  calNavBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calMonthLabel: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  calWeekRow: { flexDirection: 'row', marginBottom: 4 },
  calWeekLabel: {
    flex: 1,
    textAlign: 'center',
    color: colors.textSecondary,
    fontWeight: '700',
    fontSize: 12,
  },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  calCircle: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calCircleLogged: { backgroundColor: colors.primary },
  calCircleMissed: { backgroundColor: colors.warnSoft },
  calCircleToday: { borderWidth: 2, borderColor: colors.primary },
  calCircleOff: { backgroundColor: '#F1F5F9' },
  calCircleHoliday: { backgroundColor: colors.dangerSoft },
  calCircleExcluded: { backgroundColor: colors.warnSoft },
  calDayNum: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  calDayNumLogged: { color: '#FFFFFF' },
  calDayNumExcluded: { color: colors.textSecondary, fontWeight: '500' },
  calHours: { fontSize: 9, fontWeight: '700', color: '#FFFFFF', marginTop: 1 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,37,64,0.35)' },
  pickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingBottom: 32,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  pickerCancel: { color: colors.textSecondary, fontWeight: '700', fontSize: 16 },
  pickerDone: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    marginBottom: space.sm,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  sheetGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs },
  sheetItem: { width: '50%', paddingVertical: 6 },
  sheetLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: 2, fontWeight: '600' },
  sheetValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  sheetMeta: { color: colors.textSecondary, marginTop: space.sm, fontSize: 14 },
  notesBox: {
    marginTop: space.sm,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    padding: space.md,
  },
  notesText: { color: colors.textPrimary, marginTop: 4 },
  sheetActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },

  reasonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    marginTop: space.sm,
  },
  reasonText: { fontWeight: '700', fontSize: 13, flex: 1 },

  tagContainer: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm, gap: 8 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tagText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  tagMuted: { backgroundColor: '#F1F5F9' },
  tagTextMuted: { color: colors.textSecondary, fontWeight: '600' },

  toast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  toastText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  loadingText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 48,
    color: colors.textPrimary,
  },
});