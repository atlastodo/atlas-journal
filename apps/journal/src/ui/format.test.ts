import { formatDay, headline, preview } from "./format";

const entry = {
  id: "x",
  date: "2026-10-18",
  title: "",
  body: "# A heading\nFirst line\n\nSecond   line",
  mood: null,
  tags: [],
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
};

describe("format", () => {
  it("names nearby days and spells out the rest", () => {
    expect(formatDay("2026-10-18", "2026-10-18")).toBe("Today");
    expect(formatDay("2026-10-17", "2026-10-18")).toBe("Yesterday");
    expect(formatDay("2026-10-19", "2026-10-18")).toBe("Tomorrow");
    expect(formatDay("2026-10-14", "2026-10-18", "en-GB")).toMatch(/^Wednesday,? 14 October 2026$/);
  });

  it("uses the body's first line for an untitled entry", () => {
    expect(headline(entry)).toBe("A heading");
    expect(preview(entry)).toBe("First line Second line");
    expect(headline({ ...entry, title: "Walk" })).toBe("Walk");
    expect(preview({ ...entry, title: "Walk" })).toBe("A heading First line Second line");
    expect(headline({ ...entry, body: "" })).toBe("Untitled");
  });
});
