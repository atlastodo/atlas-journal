import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { JOURNAL_ENTRY } from "@atlastodo/journal-core";
import { memoryJournal } from "../test/journal";
import { EntryEditorScreen } from "./EntryEditorScreen";

const NOW = new Date(2026, 9, 18, 12).getTime();

async function setup(id: string | null = null, journal = memoryJournal(() => NOW)) {
  const onDone = jest.fn();
  await render(
    <journal.Provider>
      <EntryEditorScreen id={id} onDone={onDone} now={() => NOW} />
    </journal.Provider>,
  );
  return { journal, onDone };
}

describe("EntryEditorScreen", () => {
  it("writes a new entry with today's date, mood and tags", async () => {
    const { journal, onDone } = await setup();
    expect(screen.getByLabelText("Date").props.value).toBe("2026-10-18");
    await fireEvent.changeText(screen.getByLabelText("Title"), "  Harbour walk ");
    await fireEvent.changeText(screen.getByLabelText("Entry"), "Fog over the water.");
    await fireEvent.press(screen.getByRole("radio", { name: "Good (4 of 5)" }));
    await fireEvent.changeText(screen.getByLabelText("Add a tag"), "walks,");
    await fireEvent.changeText(screen.getByLabelText("Add a tag"), "#Sea");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(onDone).toHaveBeenCalled();
    expect(journal.kicks.count).toBe(1);
    expect(journal.entries.list()).toEqual([
      expect.objectContaining({
        date: "2026-10-18",
        title: "Harbour walk",
        body: "Fog over the water.",
        mood: 4,
        tags: ["walks", "Sea"],
      }),
    ]);
  });

  it("says what is wrong instead of saving", async () => {
    const { journal, onDone } = await setup();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("A journal entry needs a title or a body.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Title"), "x");
    await fireEvent.changeText(screen.getByLabelText("Date"), "2026-02-30");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Use a date like 2026-10-18.")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(journal.entries.list()).toEqual([]);
  });

  it("edits an entry and clears its mood", async () => {
    const journal = memoryJournal(() => NOW);
    const e = journal.entries.create({ title: "Walk", mood: 3, date: "2026-10-17" });
    await setup(e.id, journal);
    expect(screen.getByLabelText("Title").props.value).toBe("Walk");
    await fireEvent.press(screen.getByRole("radio", { name: "Okay (3 of 5)" }));
    await fireEvent.press(screen.getByRole("button", { name: "Yesterday" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(journal.entries.get(e.id)).toMatchObject({ mood: null, date: "2026-10-17" });
  });

  it("moves an entry to the trash after asking", async () => {
    const journal = memoryJournal(() => NOW);
    const e = journal.entries.create({ title: "Walk" });
    jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === "destructive")?.onPress?.();
    });
    const { onDone } = await setup(e.id, journal);
    await fireEvent.press(screen.getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(journal.entries.get(e.id)?.deleted_at).toBe(NOW);
  });

  it("does not open an entry it cannot decrypt", async () => {
    const journal = memoryJournal(() => NOW);
    const e = journal.entries.create({ title: "Walk" });
    journal.store.set(JOURNAL_ENTRY, e.id, "body", {
      __enc: 2,
      kid: "dek",
      iv: "aa",
      ct: "bb",
    });
    await setup(e.id, journal);
    expect(screen.getByText("Locked entry")).toBeTruthy();
  });
});
