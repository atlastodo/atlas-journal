import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useJournal } from "../data/JournalProvider";
import { Button, Header, Muted, Screen, styles as ui } from "../ui/components";
import { formatTime, headline } from "../ui/format";
import { space, usePalette } from "../ui/theme";

/** Entries moved to the trash (here, on another device or by the CLI), with Restore. */
export function TrashScreen({ onBack }: { onBack: () => void }) {
  const p = usePalette();
  const { entries, version, kick } = useJournal();
  const trashed = useMemo(
    () => entries.trashed(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, version],
  );
  return (
    <Screen>
      <Header title="Trash" right={<Button label="Back" kind="ghost" onPress={onBack} />} />
      <Muted>Entries in the trash stay encrypted and synced until you restore them.</Muted>
      <FlatList
        style={[ui.fill, local.list]}
        data={trashed}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => (
          <View style={[ui.card, local.row, { backgroundColor: p.surface, borderColor: p.border }]}>
            <View style={ui.fill}>
              <Text style={[local.title, { color: p.text }]} numberOfLines={1}>
                {headline(item)}
              </Text>
              <Text style={[ui.small, { color: p.muted }]}>
                {item.date} · trashed {formatTime(item.deleted_at ?? 0)}
              </Text>
            </View>
            <Button
              label="Restore"
              accessibilityLabel={`Restore ${headline(item)}`}
              onPress={() => {
                entries.restore(item.id);
                kick();
              }}
            />
          </View>
        )}
        ListEmptyComponent={<Muted>The trash is empty.</Muted>}
      />
    </Screen>
  );
}

const local = StyleSheet.create({
  list: { marginTop: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  title: { fontSize: 16, fontWeight: "600" },
});
