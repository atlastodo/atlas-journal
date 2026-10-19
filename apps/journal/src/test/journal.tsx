import { useEffect, useState, type ReactNode } from "react";
import { LocalStore } from "@atlastodo/client-core";
import { JournalEntries } from "@atlastodo/journal-core";
import { JournalContext, type JournalValue } from "../data/JournalProvider";

/** A journal in memory (a real store, no server) and a provider for it, for screen tests. */
export function memoryJournal(now: () => number = Date.now) {
  let n = 0;
  const store = new LocalStore("test-device", {
    now,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  const entries = new JournalEntries(store, { now });
  const kicks = { count: 0 };

  function Provider({ children, extra }: { children: ReactNode; extra?: Partial<JournalValue> }) {
    const [version, setVersion] = useState(0);
    useEffect(() => store.onChange(() => setVersion((v) => v + 1)), []);
    const value: JournalValue = {
      entries,
      version,
      status: "idle",
      pending: store.unsyncedOps().length,
      lastError: null,
      lastSyncAt: null,
      kick: () => {
        kicks.count++;
      },
      ...extra,
    };
    return <JournalContext.Provider value={value}>{children}</JournalContext.Provider>;
  }

  return { store, entries, kicks, Provider };
}
