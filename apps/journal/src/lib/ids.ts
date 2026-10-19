/** Entity ids: v4 UUIDs (the server refuses a non-UUID `entity_id`). */
export const newId = (): string => globalThis.crypto.randomUUID();
