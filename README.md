# OJT Tracker

A local-first Expo app to track OJT hours toward a 486-hour requirement with a March 31 deadline and a last render day of March 30.

## Run locally

```bash
npm install
npm start
```

Then open the app in Expo Go, an Android emulator, or iOS simulator.

## Offline testing

- Turn on airplane mode in the simulator or device.
- The app stores all data locally with AsyncStorage and keeps all features usable without a network connection.
- Export and import backup data are also local/offline actions.

## Backup and restore

1. Open Settings.
2. Tap Export backup.
3. Share the generated JSON file or save it to local storage.
4. To restore, tap Import backup and pick the saved JSON file.

## Data model

The app stores a `schemaVersion` field in the main persisted object and keeps all entries and settings in AsyncStorage.

## Notes

- This version is intentionally local-only and contains no user accounts or backend sync.
- The app uses Asia/Manila time display while storing timestamps in UTC.
- A soft cap warning is shown for days above 12 hours, but it never blocks saving.
