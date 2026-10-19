import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button, ErrorText, Field, Header, Muted, Screen } from "../ui/components";
import { describeError } from "../ui/errors";
import { space } from "../ui/theme";
import { useAuth } from "./AuthContext";

/**
 * A session whose journal keys are not on this device (a browser that could not keep them, or a
 * cleared key store) opens with the account password; nothing syncs until it does.
 */
export function UnlockScreen() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await auth.unlock(password))) setError("That password does not open this journal.");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Header title="Unlock your journal" subtitle={auth.session?.user.email} />
      <Muted>Enter your Atlas password to open your journal's encryption key on this device.</Muted>
      <View style={local.form}>
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          onSubmitEditing={submit}
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button kind="primary" label="Unlock" onPress={submit} busy={busy} />
        <Button kind="ghost" label="Sign out" onPress={() => void auth.signOut()} disabled={busy} />
      </View>
    </Screen>
  );
}

const local = StyleSheet.create({ form: { marginTop: space.xl, gap: space.sm } });
