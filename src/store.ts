// Utilitaires partagés.
export const uid = () => (globalThis.crypto?.randomUUID?.() ?? "id-" + Math.random().toString(36).slice(2));
export const nowIso = () => new Date().toISOString();
