import { useLocalSearchParams, useRouter } from "expo-router";
import { EntryEditorScreen } from "../../src/screens/EntryEditorScreen";

export default function Entry() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const done = () => (router.canGoBack() ? router.back() : router.replace("/"));
  // Keyed by id: opening another entry starts a fresh form.
  return <EntryEditorScreen key={id} id={id === "new" ? null : (id ?? null)} onDone={done} />;
}
