import { useRouter } from "expo-router";
import { EntriesScreen } from "../src/screens/EntriesScreen";

export default function Entries() {
  const router = useRouter();
  return (
    <EntriesScreen
      onOpen={(id) => router.push({ pathname: "/entry/[id]", params: { id } })}
      onNew={() => router.push({ pathname: "/entry/[id]", params: { id: "new" } })}
      onSettings={() => router.push("/settings")}
    />
  );
}
