import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  addDays,
  cleanTags,
  dayOf,
  isCalendarDay,
  tagCounts,
  type JournalFields,
  type Mood,
} from "@atlastodo/journal-core";
import { useJournal } from "../data/JournalProvider";
import {
  Button,
  Chip,
  ErrorText,
  Field,
  Header,
  Muted,
  MoodPicker,
  Screen,
  confirm,
  styles as ui,
} from "../ui/components";
import { describeError } from "../ui/errors";
import { formatDay, formatTime } from "../ui/format";
import { space, usePalette } from "../ui/theme";

/**
 * Write a new entry (`id` null) or edit one: its day, title, body (plain text; Markdown reads
 * fine), mood and tags. Saving writes only what changed; "Move to trash" is a soft delete the
 * trash can undo.
 */
export function EntryEditorScreen({
  id,
  onDone,
  now = Date.now,
}: {
  id: string | null;
  onDone: () => void;
  now?: () => number;
}) {
  const p = usePalette();
  const { entries, kick, version } = useJournal();
  const existing = useMemo(
    () => (id ? entries.get(id) : null),
    // Read once per store change; the form keeps its own state after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, id, version],
  );
  const today = dayOf(now());
  const [date, setDate] = useState(existing?.date ?? today);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [mood, setMood] = useState<Mood | null>(existing?.mood ?? null);
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(
    () =>
      tagCounts(entries.list())
        .map((t) => t.tag)
        .filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()))
        .filter((t) => !tagDraft || t.toLowerCase().startsWith(tagDraft.trim().toLowerCase()))
        .slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, version, tags, tagDraft],
  );

  if (id && !existing) {
    return (
      <Screen>
        <Header title="Entry not found" />
        <Muted>It may have been deleted on another device.</Muted>
        <Button label="Back" onPress={onDone} style={local.top} />
      </Screen>
    );
  }
  if (existing?.locked) {
    return (
      <Screen>
        <Header title="Locked entry" />
        <Muted>
          This entry was written with a key this device does not have yet. It opens once the key
          arrives.
        </Muted>
        <Button label="Back" onPress={onDone} style={local.top} />
      </Screen>
    );
  }

  const addTags = (text: string) => {
    const parts = text.split(",").map((t) => t.trim().replace(/^#/, ""));
    setTags((prev) => cleanTags([...prev, ...parts]));
    setTagDraft("");
  };

  const save = () => {
    setError(null);
    if (!isCalendarDay(date.trim())) return setError("Use a date like 2026-10-18.");
    const fields: JournalFields = {
      date: date.trim(),
      title,
      body,
      mood,
      tags: cleanTags([...tags, ...tagDraft.split(",").map((t) => t.replace(/^#/, ""))]),
    };
    try {
      if (existing) entries.update(existing.id, fields);
      else entries.create(fields);
    } catch (err) {
      return setError(describeError(err));
    }
    kick();
    onDone();
  };

  const trash = async () => {
    if (!existing) return;
    const ok = await confirm(
      "Move to trash?",
      "You can restore it from the trash in Settings.",
      "Move to trash",
    );
    if (!ok) return;
    entries.trash(existing.id);
    kick();
    onDone();
  };

  return (
    <Screen
      scroll
      footer={
        <View style={local.footer}>
          {existing ? <Button kind="danger" label="Move to trash" onPress={trash} /> : null}
          <View style={ui.fill} />
          <Button label="Cancel" onPress={onDone} />
          <Button kind="primary" label="Save" onPress={save} />
        </View>
      }
    >
      <Header
        title={existing ? "Edit entry" : "New entry"}
        subtitle={isCalendarDay(date.trim()) ? formatDay(date.trim(), today) : undefined}
      />
      {existing?.deleted_at ? <ErrorText>This entry is in the trash.</ErrorText> : null}
      <Field
        label="Date"
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={10}
      />
      <View style={[ui.row, local.dateChips]}>
        <Chip label="Today" selected={date === today} onPress={() => setDate(today)} />
        <Chip
          label="Yesterday"
          selected={date === addDays(today, -1)}
          onPress={() => setDate(addDays(today, -1))}
        />
      </View>
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Optional" />
      <Field
        label="Entry"
        value={body}
        onChangeText={setBody}
        multiline
        placeholder="What happened today? Plain text; Markdown works too."
      />
      <MoodPicker value={mood} onChange={setMood} />
      <View style={ui.field}>
        <Text style={[ui.label, { color: p.muted }]}>Tags</Text>
        {tags.length > 0 ? (
          <View style={[ui.row, local.chips]}>
            {tags.map((t) => (
              <Chip
                key={t}
                label={`#${t}  ×`}
                selected
                accessibilityLabel={`Remove tag ${t}`}
                onPress={() => setTags((prev) => prev.filter((x) => x !== t))}
              />
            ))}
          </View>
        ) : null}
        <TextInput
          accessibilityLabel="Add a tag"
          value={tagDraft}
          onChangeText={(text) => (text.includes(",") ? addTags(text) : setTagDraft(text))}
          onSubmitEditing={() => tagDraft.trim() && addTags(tagDraft)}
          placeholder="Add a tag and press Enter"
          placeholderTextColor={p.muted}
          autoCapitalize="none"
          autoCorrect={false}
          submitBehavior="submit"
          style={[ui.input, { color: p.text, backgroundColor: p.surface, borderColor: p.border }]}
        />
        {suggestions.length > 0 ? (
          <View style={[ui.row, local.chips]}>
            {suggestions.map((t) => (
              <Chip
                key={t}
                label={`+ #${t}`}
                accessibilityLabel={`Add tag ${t}`}
                onPress={() => addTags(t)}
              />
            ))}
          </View>
        ) : null}
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {existing ? (
        <Muted>
          Written {formatTime(existing.created_at)}
          {existing.updated_at !== existing.created_at
            ? ` · edited ${formatTime(existing.updated_at)}`
            : ""}
        </Muted>
      ) : null}
    </Screen>
  );
}

const local = StyleSheet.create({
  top: { marginTop: space.xl, alignSelf: "flex-start" },
  dateChips: { marginTop: -space.sm, marginBottom: space.lg },
  chips: { marginBottom: space.sm },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.md,
  },
});
