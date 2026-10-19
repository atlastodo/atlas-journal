import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import type { ApiTokenView } from "@atlastodo/client-core";
import { createJournalToken, listJournalTokens } from "@atlastodo/journal-core";
import { useAuth } from "../auth/AuthContext";
import { useJournal } from "../data/JournalProvider";
import {
  Body,
  Button,
  Card,
  ErrorText,
  Field,
  Header,
  Muted,
  Screen,
  SectionTitle,
  confirm,
  styles as ui,
} from "../ui/components";
import { describeError } from "../ui/errors";
import { formatTime } from "../ui/format";
import { space, usePalette } from "../ui/theme";
import { syncSummary } from "./SyncLine";

const REPO_URL = process.env.EXPO_PUBLIC_REPO_URL || "https://github.com/atlastodo/atlas-journal";

export function SettingsScreen({ onBack, onTrash }: { onBack: () => void; onTrash: () => void }) {
  const auth = useAuth();
  const journal = useJournal();
  const p = usePalette();

  const signOut = async () => {
    const message =
      journal.pending > 0
        ? `${journal.pending} change(s) have not reached the server yet and will be lost. This device's copy of your journal is deleted.`
        : "This device's copy of your journal is deleted; your entries stay on the server.";
    if (await confirm("Sign out?", message, "Sign out")) await auth.signOut();
  };

  return (
    <Screen scroll>
      <Header title="Settings" right={<Button label="Done" kind="ghost" onPress={onBack} />} />

      <SectionTitle>Account</SectionTitle>
      <Card>
        <Body>{auth.session?.user.email}</Body>
        <Muted>Server: {auth.serverUrl}</Muted>
        <Muted>
          Your Atlas account, shared with Atlas Todo. Change the password or recovery phrase there.
        </Muted>
      </Card>

      <SectionTitle>Sync</SectionTitle>
      <Card>
        <Body>{syncSummary(journal)}</Body>
        {journal.lastSyncAt ? <Muted>Last synced {formatTime(journal.lastSyncAt)}</Muted> : null}
        {journal.lastError ? <ErrorText>{journal.lastError}</ErrorText> : null}
        <Button label="Sync now" onPress={journal.kick} style={local.cardAction} />
      </Card>

      <SectionTitle>API tokens</SectionTitle>
      <ApiTokens />

      <SectionTitle>Entries</SectionTitle>
      <Button label="Open the trash" onPress={onTrash} style={local.start} />

      <SectionTitle>About</SectionTitle>
      <Card>
        <Body>Atlas Journal {Constants.expoConfig?.version ?? ""}</Body>
        <Muted>Free software under the GNU AGPL v3. Source: {REPO_URL}</Muted>
      </Card>

      <View style={[local.signOut, { borderTopColor: p.border }]}>
        <Button kind="danger" label="Sign out" onPress={signOut} />
      </View>
    </Screen>
  );
}

/**
 * Journal-only API tokens for the `atlas journal entries` CLI and automations. A new token is
 * shown once; it carries the journal key wrapped for itself, and nothing of todo's.
 */
function ApiTokens() {
  const { api, session, keys, serverUrl } = useAuth();
  const p = usePalette();
  const [tokens, setTokens] = useState<ApiTokenView[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTokens(await listJournalTokens(api));
    } catch (err) {
      setError(describeError(err));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!session || !keys) return;
    setBusy(true);
    setError(null);
    try {
      const made = await createJournalToken(api, {
        userId: session.user.id,
        keys,
        name: name || "Atlas Journal CLI",
      });
      setCreated(made.token);
      setName("");
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: ApiTokenView) => {
    const ok = await confirm(
      `Revoke “${token.name}”?`,
      "Anything using it loses access right away.",
      "Revoke",
    );
    if (!ok) return;
    try {
      await api.revokeApiToken(token.id);
      await load();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Card>
      <Muted>
        For the atlas command-line tool and automations such as n8n: a token reads and writes your
        journal (nothing of Atlas Todo).
      </Muted>
      {created ? (
        <View style={[local.created, { backgroundColor: p.accentSoft }]}>
          <Body>Copy it now; it is not shown again:</Body>
          <Text selectable style={[local.mono, { color: p.text }]}>
            {created}
          </Text>
          <Text selectable style={[local.mono, { color: p.muted }]}>
            ATLAS_URL={serverUrl} ATLAS_TOKEN=… atlas journal entries list
          </Text>
          <Button
            label="I have copied it"
            kind="ghost"
            onPress={() => setCreated(null)}
            style={local.start}
          />
        </View>
      ) : null}
      {tokens?.map((t) => (
        <View key={t.id} style={[local.token, { borderTopColor: p.border }]}>
          <View style={ui.fill}>
            <Body>{t.name}</Body>
            <Muted>
              Made {formatTime(t.created_at)}
              {t.last_used_at ? ` · used ${formatTime(t.last_used_at)}` : " · never used"}
            </Muted>
          </View>
          <Button label="Revoke" kind="danger" onPress={() => void revoke(t)} />
        </View>
      ))}
      {tokens && tokens.length === 0 ? <Muted>No journal tokens yet.</Muted> : null}
      <View style={local.form}>
        <Field label="New token name" value={name} onChangeText={setName} placeholder="n8n" />
        <Button label="Create token" onPress={create} busy={busy} style={local.start} />
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}

const local = StyleSheet.create({
  cardAction: { marginTop: space.md, alignSelf: "flex-start" },
  start: { alignSelf: "flex-start" },
  signOut: {
    marginTop: space.xxl,
    paddingTop: space.lg,
    borderTopWidth: 1,
    alignItems: "flex-start",
  },
  created: { borderRadius: 10, padding: space.md, marginVertical: space.md, gap: space.sm },
  mono: { fontFamily: "monospace", fontSize: 13 },
  token: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    paddingTop: space.md,
    marginTop: space.md,
  },
  form: { marginTop: space.lg },
});
