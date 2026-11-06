//! The `atlas-journal` binary end to end against a real server: the one in `ATLAS_E2E_SERVER`
//! (core's `atlas-server` offering `ATLAS_APPS=todo,journal`; `scripts/e2e-cli.sh` starts one and
//! runs these with `--run-ignored all`). An account signs up, enables Atlas Journal as the app does
//! and makes a journal-only API token; the CLI writes entries with it, and a second session checks
//! that the server only ever held ciphertext under the journal key. A todo token is refused with a
//! JSON error.

use std::process::Command;

use atlas_client::api::{ApiClient, UreqTransport};
use atlas_client::crypto::{
    format_api_token, generate_api_token, random_bytes, wrap_app_keys_for_api_token,
    wrap_keys_for_api_token, x25519_public_key, FieldEnvelope, Keyring,
};
use atlas_client::session::ConnectOptions;
use atlas_client::wire::open_sealed;
use atlas_journal_rules::JournalClient;
use serde_json::{json, Value};
use uuid::Uuid;

/// The server in `ATLAS_E2E_SERVER` (it must offer Atlas Journal and lift its auth rate limit:
/// every CLI run signs in).
fn server() -> String {
    std::env::var("ATLAS_E2E_SERVER")
        .ok()
        .filter(|u| !u.is_empty())
        .expect("ATLAS_E2E_SERVER names a server offering todo and journal (scripts/e2e-cli.sh)")
        .trim_end_matches('/')
        .to_owned()
}

fn wrapped() -> Value {
    json!({ "v": 1, "iv": hex::encode(random_bytes::<12>()), "ct": hex::encode(random_bytes::<48>()) })
}

/// Sign up an account and make an API token for it; returns the token string.
fn account_with_token(base: &str) -> String {
    let api = ApiClient::new(base, Box::new(UreqTransport::default()));
    let dek: [u8; 32] = random_bytes();
    let private_key: [u8; 32] = random_bytes();
    let signup = api
        .request(
            "POST",
            "/auth/signup",
            Some(&json!({
                "email": format!("cli-{}@example.com", Uuid::now_v7()),
                "password": hex::encode(random_bytes::<32>()),
                "salt": hex::encode(random_bytes::<16>()),
                "public_key": x25519_public_key(&private_key),
                "recovery_public_key": x25519_public_key(&random_bytes()),
                "encrypted_dek": wrapped(),
                "encrypted_private_key": wrapped(),
                "recovery_encrypted_dek": wrapped(),
                "recovery_encrypted_private_key": wrapped(),
            })),
        )
        .expect("signs up");
    let user_id = signup["user"]["id"].as_str().unwrap().to_owned();
    api.set_token(Some(signup["access_token"].as_str().unwrap().to_owned()));
    let token = generate_api_token();
    let wraps = wrap_keys_for_api_token(&token, &user_id, &dek, &private_key).unwrap();
    let auth = atlas_client::crypto::derive_api_token_keys(&token).auth;
    api.request(
        "POST",
        "/auth/api-tokens",
        Some(&json!({
            "id": token.id, "name": "cli e2e", "auth": auth,
            "wrapped_dek": wraps.wrapped_dek, "wrapped_private_key": wraps.wrapped_private_key,
        })),
    )
    .expect("creates a token");
    format_api_token(&token)
}

/// Run the built `atlas-journal` binary; returns (exit code, stdout JSON or text, stderr).
fn atlas_journal(base: &str, token: &str, args: &[&str]) -> (i32, Value, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_atlas-journal"))
        .args(args)
        .env("ATLAS_URL", base)
        .env("ATLAS_TOKEN", token)
        .env("ATLAS_TZ", "Europe/Copenhagen")
        .env_remove("ATLAS_STATE_DIR")
        .output()
        .expect("runs atlas-journal");
    let stdout = String::from_utf8(out.stdout).unwrap();
    let json = serde_json::from_str(&stdout).unwrap_or(Value::String(stdout));
    (
        out.status.code().unwrap(),
        json,
        String::from_utf8(out.stderr).unwrap(),
    )
}

/// Sign up a current account (a root key and the todo key under it), enable Atlas Journal as the
/// app does (its key under the root, then the app), and make a journal-only API token carrying the
/// journal key and identity. Returns the token string and the journal key.
fn account_with_journal_token(base: &str) -> (String, [u8; 32]) {
    let api = ApiClient::new(base, Box::new(UreqTransport::default()));
    let user_id = Uuid::new_v4().to_string();
    let signup = api
        .request(
            "POST",
            "/auth/signup",
            Some(&json!({
                "email": format!("cli-journal-{}@example.com", Uuid::now_v7()),
                "password": hex::encode(random_bytes::<32>()),
                "salt": hex::encode(random_bytes::<16>()),
                "public_key": x25519_public_key(&random_bytes()),
                "recovery_public_key": x25519_public_key(&random_bytes()),
                "encrypted_dek": wrapped(),
                "encrypted_private_key": wrapped(),
                "recovery_encrypted_dek": wrapped(),
                "recovery_encrypted_private_key": wrapped(),
                "user_id": user_id,
                "encrypted_root_key": wrapped(),
                "recovery_encrypted_root_key": wrapped(),
                "app_keys": [{ "app": "todo", "wrapped_key": wrapped(), "wrapped_private_key": wrapped() }],
            })),
        )
        .expect("signs up");
    api.set_token(Some(signup["access_token"].as_str().unwrap().to_owned()));
    api.request(
        "PUT",
        "/auth/app-keys/journal",
        Some(&json!({ "wrapped_key": wrapped(), "wrapped_private_key": wrapped() })),
    )
    .expect("stores the journal key");
    api.request("PUT", "/auth/apps/journal", None)
        .expect("enables journal");

    let journal_key: [u8; 32] = random_bytes();
    let journal_private: [u8; 32] = random_bytes();
    let token = generate_api_token();
    let wraps =
        wrap_app_keys_for_api_token(&token, &user_id, "journal", &journal_key, &journal_private)
            .unwrap();
    let auth = atlas_client::crypto::derive_api_token_keys(&token).auth;
    let made = api
        .request(
            "POST",
            "/auth/api-tokens",
            Some(&json!({
                "id": token.id, "name": "journal e2e", "auth": auth,
                "apps": ["journal"], "app_keys": { "journal": wraps },
            })),
        )
        .expect("creates a journal token");
    assert_eq!(made["apps"], json!(["journal"]));
    (format_api_token(&token), journal_key)
}

#[test]
#[ignore = "end to end: scripts/e2e-cli.sh runs it against the server in ATLAS_E2E_SERVER"]
fn the_cli_writes_journal_entries_with_a_journal_only_token() {
    let base = server();
    let (token, journal_key) = account_with_journal_token(&base);

    let (code, added, err) = atlas_journal(
        &base,
        &token,
        &[
            "journal",
            "entries",
            "add",
            "--date",
            "2026-10-17",
            "--title",
            "Harbour walk",
            "--body",
            "Fog over the water.",
            "--mood",
            "4",
            "--tag",
            "walks",
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(added["title"], "Harbour walk");
    assert_eq!(added["mood"], 4);
    assert_eq!(added["tags"], json!(["walks"]));
    let id = added["id"].as_str().unwrap().to_owned();

    let (code, _, err) = atlas_journal(
        &base,
        &token,
        &[
            "journal",
            "entries",
            "add",
            "--json",
            r#"{"date": "2026-10-16", "body": "From n8n", "tags": ["n8n"]}"#,
        ],
    );
    assert_eq!(code, 0, "{err}");
    let (code, listed, err) = atlas_journal(&base, &token, &["journal", "entries", "list"]);
    assert_eq!(code, 0, "{err}");
    let dates: Vec<&str> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["date"].as_str().unwrap())
        .collect();
    assert_eq!(dates, ["2026-10-17", "2026-10-16"]);

    let (code, updated, err) = atlas_journal(
        &base,
        &token,
        &[
            "journal",
            "entries",
            "update",
            &id,
            "--body",
            "Fog, then sun.",
            "--mood",
            "none",
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(updated["body"], "Fog, then sun.");
    assert!(updated["mood"].is_null());
    let (code, got, _) = atlas_journal(&base, &token, &["journal", "entries", "get", &id]);
    assert_eq!(code, 0);
    assert_eq!(got["body"], "Fog, then sun.");
    let (code, _, err) = atlas_journal(&base, &token, &["journal", "entries", "delete", &id]);
    assert_eq!(code, 0, "{err}");
    let (_, listed, _) = atlas_journal(
        &base,
        &token,
        &["journal", "entries", "list", "--tag", "walks"],
    );
    assert_eq!(listed, json!([]));

    // Another session opens what the CLI wrote; the server held only ciphertext under the journal
    // key, as journal.entry ops.
    let mut opts = ConnectOptions::new(&base, &token);
    opts.app = "journal".into();
    let client = JournalClient::connect(opts).expect("a journal session connects");
    assert_eq!(client.journal_entry(&id).unwrap().body, "Fog, then sun.");
    let pulled = client
        .session()
        .api
        .request("GET", "/sync/pull?since=0", None)
        .unwrap();
    let raw = pulled.to_string();
    assert!(!raw.contains("Harbour") && !raw.contains("Fog") && !raw.contains("walks"));
    let ops = pulled["operations"].as_array().unwrap();
    assert!(!ops.is_empty());
    for op in ops {
        assert_eq!(op["entity"], "journal.sealed");
        let envelope = FieldEnvelope::from_value_v3(&op["value"]).expect("encrypted");
        let opened = open_sealed(
            &Keyring::new(journal_key, [0; 32], None),
            "journal.sealed",
            op["entity_id"].as_str().unwrap(),
            op["field"].as_str().unwrap(),
            None,
            &envelope,
        )
        .expect("the journal key opens it");
        assert_eq!(opened.kind.as_str(), "journal.entry");
    }
}

#[test]
#[ignore = "end to end: scripts/e2e-cli.sh runs it against the server in ATLAS_E2E_SERVER"]
fn journal_commands_need_a_token_with_journal() {
    // A todo token on a server offering journal: refused with a JSON error naming the app.
    let base = server();
    let token = account_with_token(&base);
    let (code, _, err) = atlas_journal(&base, &token, &["journal", "entries", "list"]);
    assert_eq!(code, 1);
    let line: Value = serde_json::from_str(err.trim()).expect("a JSON error");
    assert_eq!(line["code"], "app_not_in_token", "{err}");
    assert!(
        line["error"].as_str().unwrap().contains("Atlas Journal"),
        "{err}"
    );

    // A server that does not offer journal: the client test (FakeServer) covers it.
}
