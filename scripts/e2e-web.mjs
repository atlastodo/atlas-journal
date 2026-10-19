#!/usr/bin/env node
// The web app in a real browser against a real server, and the atlas CLI beside it
// (scripts/e2e-cli.sh runs it with E2E_WEB=1): sign up, the recovery phrase, writing, editing,
// searching and trashing an entry, a journal API token made in Settings that the CLI then uses
// to read the app's entry and add one that appears in the open app, and a reload that keeps the
// session and the journal.
//
// Environment: BASE_URL (the page; a server serving the web export as STATIC_DIR), CHROMIUM (a
// Chromium binary), ATLAS_CLI (the atlas binary), SCREENSHOT_DIR (optional, keeps screenshots).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE_URL = process.env.BASE_URL;
const CLI = process.env.ATLAS_CLI;
const SHOTS = process.env.SCREENSHOT_DIR;
if (!BASE_URL || !process.env.CHROMIUM || !CLI) {
  console.error("e2e-web: set BASE_URL, CHROMIUM and ATLAS_CLI");
  process.exit(2);
}

const email = `web-e2e-${Date.now()}@example.com`;
const password = "a long journal passphrase";
let step = 0;

function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`);
  console.log(`  ok ${++step} - ${message}`);
}

function atlas(token, ...args) {
  const out = execFileSync(CLI, args, {
    env: { ...process.env, ATLAS_URL: BASE_URL, ATLAS_TOKEN: token, ATLAS_TZ: "UTC" },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

/** A text input by its label (role queries skip the screens the stack keeps hidden). */
function field(page, name) {
  return page.getByRole("textbox", { name, exact: true });
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.getByText("Atlas Journal", { exact: true }).waitFor();
  check(
    (await field(page, "Server").inputValue()) === BASE_URL,
    "the server defaults to the page's origin",
  );
  await shot(page, "sign-in");

  await page.getByRole("button", { name: "Create an account" }).click();
  await field(page, "Name (optional)").fill("Web E2E");
  await field(page, "Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Repeat password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Your recovery phrase").waitFor({ timeout: 60_000 });
  check(true, "sign-up shows the recovery phrase");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Continue to my journal" }).click();
  await page.getByText("Your journal is empty").waitFor();
  check(true, "a new journal is empty");

  await page.getByRole("button", { name: "New entry" }).click();
  await field(page, "Title").fill("Harbour walk");
  await field(page, "Entry").fill("Fog over the water.\n\nThe ferry was late.");
  await page.getByRole("radio", { name: "Good (4 of 5)" }).click();
  await field(page, "Add a tag").fill("walks");
  await field(page, "Add a tag").press("Enter");
  await field(page, "Add a tag").fill("sea,");
  await shot(page, "editor");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Open entry Harbour walk" }).waitFor();
  check(true, "a saved entry is listed");
  check(await page.getByRole("heading", { name: "Today", exact: true }).isVisible(), "under Today");

  await page.getByRole("button", { name: "Open entry Harbour walk" }).click();
  await field(page, "Title").fill("Harbour walk at dawn");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Open entry Harbour walk at dawn" }).waitFor();
  check(true, "an edit is listed");

  await field(page, "Search entries").fill("#nothing");
  await page.getByText("No entries match").waitFor();
  await field(page, "Search entries").fill("ferry");
  await page.getByRole("button", { name: "Open entry Harbour walk at dawn" }).waitFor();
  check(true, "search finds the body's words and nothing for an unknown tag");
  await field(page, "Search entries").fill("");

  // A journal token from Settings, as a user would make one for the CLI.
  await page.getByRole("button", { name: "Settings" }).click();
  await field(page, "New token name").fill("web e2e");
  await page.getByRole("button", { name: "Create token" }).click();
  const tokenText = page.getByText(/^atlas_pat_/);
  await tokenText.waitFor();
  const token = (await tokenText.textContent()).trim();
  check(token.startsWith("atlas_pat_"), "Settings makes a journal API token");
  await page.getByText("Synced · end-to-end encrypted").filter({ visible: true }).waitFor();
  await shot(page, "settings");

  // The app pushes in the background; give it a few polls.
  let mine;
  for (let i = 0; i < 15 && !mine; i++) {
    mine = atlas(token, "journal", "entries", "list").find(
      (e) => e.title === "Harbour walk at dawn",
    );
    if (!mine) await page.waitForTimeout(2_000);
  }
  check(
    mine && mine.mood === 4 && mine.tags.join() === "walks,sea" && mine.body.includes("ferry"),
    "the CLI reads the entry the web app wrote",
  );

  const added = atlas(
    token,
    "journal",
    "entries",
    "add",
    "--title",
    "Written by the CLI",
    "--body",
    "From a terminal.",
    "--tag",
    "cli",
    "--date",
    "yesterday",
  );
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Open entry Written by the CLI" }).waitFor({
    timeout: 45_000,
  });
  check(true, "an entry the CLI adds appears in the open app");
  check(
    await page.getByRole("heading", { name: "Yesterday", exact: true }).isVisible(),
    "under Yesterday",
  );
  await shot(page, "entries");

  // Trash in the app; the CLI no longer lists it.
  await page.getByRole("button", { name: "Open entry Written by the CLI" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Move to trash" }).click();
  await page.getByRole("button", { name: "Open entry Harbour walk at dawn" }).waitFor();
  let afterTrash = [];
  for (let i = 0; i < 15; i++) {
    afterTrash = atlas(token, "journal", "entries", "list");
    if (!afterTrash.some((e) => e.id === added.id)) break;
    await page.waitForTimeout(2_000);
  }
  check(!afterTrash.some((e) => e.id === added.id), "the CLI leaves out what the app trashed");
  check(
    atlas(token, "journal", "entries", "get", added.id).deleted_at !== null,
    "the trashed entry has deleted_at",
  );

  // A reload keeps the session and the journal (keys sealed in the browser's key store).
  await page.reload();
  await page.getByRole("button", { name: "Open entry Harbour walk at dawn" }).waitFor();
  check(true, "a reload keeps the session and the journal");

  check(errors.length === 0, `no uncaught page errors (${errors.join("; ")})`);
  console.log(`e2e-web: ${step} checks passed`);
} finally {
  await browser.close();
}
