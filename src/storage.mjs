import { createDefaultState, normalizeState, STORAGE_KEY } from "./domain.mjs";

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.error(error);
    return createDefaultState();
  }
}

export function saveState(state) {
  const payload = JSON.stringify(normalizeState(state));
  localStorage.setItem(`${STORAGE_KEY}:last-good`, payload);
  localStorage.setItem(STORAGE_KEY, payload);
}

export function exportBackup(state) {
  downloadText(
    `auction-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(normalizeState(state), null, 2),
    "application/json",
  );
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
