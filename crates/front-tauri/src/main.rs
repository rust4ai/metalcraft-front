// Release builds open a window, not a console — without this Windows shows a
// stray terminal behind the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod rpc;
mod state;

use std::sync::Arc;

use state::AppState;

/// The webview's own report on how boot went.
///
/// A blank white window says nothing: the process is alive, the log is empty, and
/// there is no way to tell "the page never loaded" from "the bundle threw". This
/// command is what the page uses to say which it was, so a failure shows up in
/// the terminal instead of requiring someone to open an inspector.
#[tauri::command]
fn report_boot(stage: String, detail: String) {
    match stage.as_str() {
        "error" => log::error!("webview boot error: {detail}"),
        _ => log::info!("webview {stage}: {detail}"),
    }
}

/// Installed before our bundle runs, so it catches a failure *in* that bundle.
const BOOT_PROBE: &str = r#"
(() => {
  const send = (stage, detail) => {
    try { window.__TAURI_INTERNALS__.invoke('report_boot', { stage, detail: String(detail) }) }
    catch (e) { /* bridge missing: nothing we can do from here */ }
  };
  send('loaded', location.href);
  window.addEventListener('error', (e) => send('error', (e && (e.message || e.type)) + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0)));
  window.addEventListener('unhandledrejection', (e) => send('error', 'unhandled rejection: ' + (e && e.reason)));
  setTimeout(() => {
    const root = document.getElementById('root');
    send('mounted', root ? `root children=${root.childElementCount}` : 'no #root element');
  }, 2000);
})();
"#;

/// Listen for `metalcraft-front://…` callbacks.
///
/// Only the *token* is extracted here and forwarded to the renderer as an
/// event — the renderer then calls `octaweave_connect`, which is where the key
/// is verified and stored. Emitting the token rather than connecting outright
/// keeps one path through the connect flow: a key pasted by hand and a key
/// returned by the browser go through exactly the same verification.
///
/// Whether Octaweave actually redirects here is its half of the contract and is
/// not knowable from outside (its site answers 200 on every path). Ours is
/// implemented and inert until it does.
fn watch_deep_links(app: &tauri::App) {
    use tauri::{Emitter, Manager};
    use tauri_plugin_deep_link::DeepLinkExt;

    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            let raw = url.to_string();
            match front_cloud::octaweave::token_from_callback(&raw) {
                Some(token) => {
                    log::info!("deep link: octaweave callback carrying a key");
                    if let Err(e) = handle.emit("octaweave://token", token) {
                        log::warn!("could not forward the octaweave token: {e}");
                    }
                    if let Some(w) = handle.get_webview_window("main") {
                        // The user's attention is in the browser; bring them back
                        // to where the confirmation is about to appear.
                        let _ = w.set_focus();
                    }
                }
                // Never log the URL itself: an unrecognised callback may still
                // carry someone's credential in a query string.
                None => log::info!("deep link: ignored a callback this app does not handle"),
            }
        }
    });
}

fn main() {
    env_logger::init();

    // Which asset source did tauri-build compile in? A blank window looks the
    // same either way, so say it out loud rather than inferring it later.
    #[cfg(dev)]
    log::info!("tauri context: cfg(dev) — the webview loads build.devUrl");
    #[cfg(not(dev))]
    log::info!("tauri context: release — the webview loads embedded frontendDist");

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(Arc::new(AppState::default()))
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main")
                && let Err(e) = window.eval(BOOT_PROBE)
            {
                log::warn!("could not install the boot probe: {e}");
            }
            watch_deep_links(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            report_boot,
            rpc::auth::login_start,
            rpc::auth::login_poll,
            rpc::auth::session,
            rpc::auth::refresh_session,
            rpc::auth::logout,
            rpc::pods::list_pods,
            rpc::pods::connect_pod,
            rpc::pods::agent_info,
            rpc::pods::active_pod,
            rpc::pods::account_credits,
            rpc::octaweave::octaweave_status,
            rpc::octaweave::octaweave_connect,
            rpc::octaweave::octaweave_install_pack,
            rpc::octaweave::octaweave_disconnect,
            rpc::octaweave::octaweave_open_keys,
            rpc::fleet::set_instance_persona,
            rpc::fleet::list_preset_personas,
            rpc::fleet::instance_memory,
            rpc::fleet::list_instances,
            rpc::fleet::list_presets,
            rpc::fleet::create_instance,
            rpc::fleet::delete_instance,
            rpc::flows::list_flows,
            rpc::flows::list_flow_runs,
            rpc::flows::flow_binding,
            rpc::flows::run_flow,
            rpc::flows::arm_schedule,
            rpc::flows::disarm_schedule,
            rpc::keys::list_keys,
            rpc::keys::inference_status,
            rpc::keys::save_key,
            rpc::keys::delete_key,
            rpc::keys::bind_interface_source,
            rpc::packs::list_registries,
            rpc::packs::registry_status,
            rpc::packs::registry_connect,
            rpc::packs::registry_disconnect,
            rpc::packs::registry_search,
            rpc::packs::registry_manifest,
            rpc::packs::list_installed_packs,
            rpc::packs::install_pack,
            rpc::chat::list_chats,
            rpc::chat::create_chat,
            rpc::chat::get_chat,
            rpc::chat::send_turn,
            rpc::chat::chat_context,
            rpc::chat::compact_chat,
            rpc::chat::clear_chat,
            rpc::chat::watch_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running metalcraft-front");
}
