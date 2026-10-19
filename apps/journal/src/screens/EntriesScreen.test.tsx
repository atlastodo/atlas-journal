import { fireEvent, render, screen } from "@testing-library/react-native";
import { memoryJournal } from "../test/journal";
import { EntriesScreen } from "./EntriesScreen";

// Noon on 18 October 2026, local time.
const NOW = new Date(2026, 9, 18, 12).getTime();

function setup() {
  const journal = memoryJournal(() => NOW);
  const handlers = { onOpen: jest.fn(), onNew: jest.fn(), onSettings: jest.fn() };
  const view = () =>
    render(
      <journal.Provider>
        <EntriesScreen {...handlers} now={() => NOW} />
      </journal.Provider>,
    );
  return { journal, handlers, view };
}

describe("EntriesScreen", () => {
  it("invites the first entry when the journal is empty", async () => {
    const { handlers, view } = await setup();
    await view();
    expect(screen.getByText("Your journal is empty")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Write the first entry" }));
    expect(handlers.onNew).toHaveBeenCalled();
  });

  it("groups entries by day, newest first, and opens one", async () => {
    const { journal, handlers, view } = await setup();
    journal.entries.create({ title: "Harbour walk", body: "Fog.", mood: 4, tags: ["walks"] });
    journal.entries.create({ body: "Quiet day\nNothing much.", date: "2026-10-17" });
    journal.entries.create({ title: "Old", date: "2026-10-01" });
    await view();
    const headings = screen.getAllByRole("header").map((h) => h.props.children);
    expect(headings).toEqual(["Journal", "Today", "Yesterday", expect.stringMatching(/2026/)]);
    // An entry without a title shows its first line.
    expect(screen.getByText("Quiet day")).toBeTruthy();
    expect(screen.getByLabelText("Mood: Good")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open entry Harbour walk" }));
    expect(handlers.onOpen).toHaveBeenCalledWith(journal.entries.list()[0]!.id);
  });

  it("searches words and #tags, and filters by a tag chip", async () => {
    const { journal, view } = await setup();
    journal.entries.create({ title: "Harbour walk", tags: ["walks"] });
    journal.entries.create({ title: "Work notes", body: "Fog of meetings", tags: ["work"] });
    await view();
    await fireEvent.changeText(screen.getByLabelText("Search entries"), "fog");
    expect(screen.queryByText("Harbour walk")).toBeNull();
    expect(screen.getByText("Work notes")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Search entries"), "");
    await fireEvent.press(screen.getByRole("button", { name: "Filter by tag walks" }));
    expect(screen.getByText("Harbour walk")).toBeTruthy();
    expect(screen.queryByText("Work notes")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Search entries"), "#nothing");
    expect(screen.getByText(/No entries match/)).toBeTruthy();
  });

  it("leaves trashed entries out", async () => {
    const { journal, view } = await setup();
    const e = journal.entries.create({ title: "Gone" });
    journal.entries.trash(e.id);
    await view();
    expect(screen.queryByText("Gone")).toBeNull();
  });
});
