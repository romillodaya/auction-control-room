import { createDefaultState, normalizeState, STORAGE_KEY } from "./domain.mjs";

const RECOVERY_KEY = `${STORAGE_KEY}:last-good`;
const LEGACY_STORAGE_KEY = "auction-control-room-v1";
const LEGACY_RECOVERY_KEY = "auction-control-room-v1:last-good";
const SAVE_ATTEMPTS = [
  { undoLimit: 20, eventLimit: 150, stripUndoMedia: true },
  { undoLimit: 10, eventLimit: 75, stripUndoMedia: true },
  { undoLimit: 3, eventLimit: 35, stripUndoMedia: true },
  { undoLimit: 0, eventLimit: 25, stripUndoMedia: true },
  { undoLimit: 0, eventLimit: 10, stripUndoMedia: true, stripAllMedia: true },
];

export function loadState() {
  try {
    const raw = safeGetItem(STORAGE_KEY);
    if (!raw) return loadRecoveryState() || createDefaultState();
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.error(error);
    return loadRecoveryState() || createDefaultState();
  }
}

export function saveState(state) {
  safeRemoveItem(RECOVERY_KEY);
  safeRemoveItem(LEGACY_STORAGE_KEY);
  safeRemoveItem(LEGACY_RECOVERY_KEY);

  let lastError = null;
  for (const options of SAVE_ATTEMPTS) {
    const persisted = compactStateForStorage(state, options);
    const payload = JSON.stringify(persisted);
    try {
      safeSetItem(STORAGE_KEY, payload);
      state.undoStack = persisted.undoStack;
      state.events = persisted.events;
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  console.error(lastError || new Error("Unable to save auction state."));
  return false;
}

export function exportBackup(state) {
  downloadText(
    `auction-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(normalizeState(state), null, 2),
    "application/json",
  );
}

function loadRecoveryState() {
  for (const key of [RECOVERY_KEY, LEGACY_RECOVERY_KEY]) {
    try {
      const raw = safeGetItem(key);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.error(error);
    }
  }
  return null;
}

function safeGetItem(key) {
  return globalThis.localStorage?.getItem(key) ?? null;
}

function safeSetItem(key, value) {
  if (!globalThis.localStorage) throw new Error("Browser storage is unavailable.");
  globalThis.localStorage.setItem(key, value);
}

function safeRemoveItem(key) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch (error) {
    console.error(error);
  }
}

function compactStateForStorage(state, { undoLimit, eventLimit, stripUndoMedia, stripAllMedia }) {
  const normalized = normalizeState(state);
  normalized.events = normalized.events.slice(0, eventLimit);
  normalized.undoStack = normalized.undoStack.slice(-undoLimit).map((snapshot) => {
    const compactSnapshot = structuredClone(snapshot);
    compactSnapshot.undoStack = [];
    compactSnapshot.events = [];
    compactSnapshot.ui = { ...(compactSnapshot.ui || {}), message: "", photoModalPlayerId: "" };

    if (stripUndoMedia) {
      stripLargeMediaFromSnapshot(compactSnapshot);
    }

    return compactSnapshot;
  });
  normalized.ui = { ...normalized.ui, message: "" };
  if (stripAllMedia) stripLargeMediaFromSnapshot(normalized);
  return normalized;
}

function stripLargeMediaFromSnapshot(snapshot) {
  if (String(snapshot.settings?.logo || "").startsWith("data:")) {
    snapshot.settings.logo = "";
  }
  for (const team of snapshot.teams || []) {
    if (String(team.logo || "").startsWith("data:")) team.logo = "";
  }
  for (const player of snapshot.players || []) {
    if (String(player.photo || "").startsWith("data:")) player.photo = "";
  }
}

export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function downloadText(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
