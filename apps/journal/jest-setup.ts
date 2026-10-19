/**
 * Jest setup: the libraries' own doubles for native modules a node process lacks. The app's own
 * modules are not mocked here.
 */
// Tests assume the default server URL; a CI that sets EXPO_PUBLIC_API_URL must not change that.
delete process.env.EXPO_PUBLIC_API_URL;

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock(
  "react-native-safe-area-context",
  () => jest.requireActual("react-native-safe-area-context/jest/mock").default,
);
