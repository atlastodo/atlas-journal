import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { RecoveryPhraseScreen } from "../src/auth/RecoveryPhraseScreen";
import { SignInScreen } from "../src/auth/SignInScreen";
import { UnlockScreen } from "../src/auth/UnlockScreen";
import { JournalProvider } from "../src/data/JournalProvider";
import { usePalette } from "../src/ui/theme";

function Loading() {
  const p = usePalette();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: p.background,
      }}
    >
      <ActivityIndicator color={p.accent} />
    </View>
  );
}

/**
 * Who sees what: the sign-in screen without a session, the recovery phrase once after sign-up,
 * the unlock screen for a session without its journal keys, else the journal.
 */
function Gate() {
  const auth = useAuth();
  const p = usePalette();
  if (!auth.restored) return <Loading />;
  if (!auth.session) return <SignInScreen />;
  if (auth.recoveryPhrase) {
    return (
      <RecoveryPhraseScreen phrase={auth.recoveryPhrase} onDone={auth.dismissRecoveryPhrase} />
    );
  }
  if (!auth.keys) return <UnlockScreen />;
  return (
    <JournalProvider
      api={auth.api}
      userId={auth.session.user.id}
      deviceId={auth.session.deviceId}
      keys={auth.keys}
      fallback={<Loading />}
    >
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.background } }}
      />
    </JournalProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
