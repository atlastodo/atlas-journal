import { useMemo, useState } from "react";
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import {
  dayOf,
  groupByDate,
  matchesSearch,
  tagCounts,
  type JournalEntry,
} from "@atlastodo/journal-core";
import { useJournal } from "../data/JournalProvider";
import { Button, Chip, Header, MoodBadge, Muted, Screen, styles as ui } from "../ui/components";
import { formatDay, headline, preview } from "../ui/format";
import { radius, space, usePalette } from "../ui/theme";
import { SyncLine } from "./SyncLine";

const TOP_TAGS = 8;

/** Every entry, newest day first, with search (words and #tags) and quick tag filters. */
export function EntriesScreen({
  onOpen,
  onNew,
  onSettings,
  now = Date.now,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  now?: () => number;
}) {
  const p = usePalette();
  const { entries, version } = useJournal();
  const [search, setSearch] = useState("");

  const all = useMemo(
    () => entries.list(),
    // `version` bumps on every store change.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [entries, version],
  );
  const tags = useMemo(() => tagCounts(all).slice(0, TOP_TAGS), [all]);
  const sections = useMemo(() => {
    const shown = all.filter((e) => matchesSearch(e, search));
    return groupByDate(shown).map((g) => ({ date: g.date, data: g.entries }));
  }, [all, search]);
  const today = dayOf(now());

  const toggleTag = (tag: string) => {
    const term = `#${tag.toLowerCase()}`;
    const terms = search.split(/\s+/).filter(Boolean);
    const has = terms.some((t) => t.toLowerCase() === term);
    setSearch(
      has ? terms.filter((t) => t.toLowerCase() !== term).join(" ") : [...terms, term].join(" "),
    );
  };

  return (
    <Screen>
      <Header
        title="Journal"
        right={
          <View style={local.headerActions}>
            <Button label="Settings" kind="ghost" onPress={onSettings} />
            <Button label="New entry" kind="primary" onPress={onNew} />
          </View>
        }
      />
      <SyncLine />
      <TextInput
        accessibilityLabel="Search entries"
        placeholder="Search, or #tag"
        placeholderTextColor={p.muted}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          ui.input,
          { color: p.text, backgroundColor: p.surface, borderColor: p.border, marginTop: space.md },
        ]}
      />
      {tags.length > 0 ? (
        <View style={[ui.row, local.tags]}>
          {tags.map(({ tag }) => (
            <Chip
              key={tag}
              label={`#${tag}`}
              selected={search.toLowerCase().split(/\s+/).includes(`#${tag.toLowerCase()}`)}
              onPress={() => toggleTag(tag)}
              accessibilityLabel={`Filter by tag ${tag}`}
            />
          ))}
        </View>
      ) : null}
      <SectionList
        style={ui.fill}
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={local.list}
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={[local.day, { color: p.muted }]}>
            {formatDay(section.date, today)}
          </Text>
        )}
        renderItem={({ item }) => <EntryCard entry={item} onPress={() => onOpen(item.id)} />}
        ListEmptyComponent={
          <View style={local.empty}>
            {all.length === 0 ? (
              <>
                <Text style={[local.emptyTitle, { color: p.text }]}>Your journal is empty</Text>
                <Muted>
                  Write about your day. Entries are encrypted on this device and sync to your other
                  devices.
                </Muted>
                <Button kind="primary" label="Write the first entry" onPress={onNew} />
              </>
            ) : (
              <Muted>No entries match “{search.trim()}”.</Muted>
            )}
          </View>
        }
      />
    </Screen>
  );
}

function EntryCard({ entry, onPress }: { entry: JournalEntry; onPress: () => void }) {
  const p = usePalette();
  const text = preview(entry);
  const title = headline(entry);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open entry ${title}`}
      onPress={onPress}
      style={({ pressed }) => [
        local.card,
        { backgroundColor: p.surface, borderColor: p.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[local.cardTitle, { color: p.text }]} numberOfLines={1}>
        {title}
      </Text>
      {text ? (
        <Text style={[local.cardBody, { color: p.muted }]} numberOfLines={2}>
          {text}
        </Text>
      ) : null}
      {entry.mood || entry.tags.length > 0 ? (
        <View style={local.meta}>
          {entry.mood ? <MoodBadge mood={entry.mood} /> : null}
          {entry.tags.map((t) => (
            <Text key={t} style={[local.tag, { color: p.accent }]}>
              #{t}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const local = StyleSheet.create({
  headerActions: { flexDirection: "row", gap: space.xs },
  tags: { marginTop: space.md },
  list: { paddingBottom: space.xxl * 2 },
  day: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.sm,
    gap: space.xs,
  },
  cardTitle: { fontSize: 17, fontWeight: "600" },
  cardBody: { fontSize: 15, lineHeight: 21 },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.md,
    marginTop: 2,
  },
  tag: { fontSize: 13, fontWeight: "500" },
  empty: { alignItems: "flex-start", gap: space.md, paddingTop: space.xxl },
  emptyTitle: { fontSize: 20, fontWeight: "700" },
});
