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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            report_boot,
            rpc::auth::login_start,
            rpc::auth::login_poll,
            rpc::auth::session,
            rpc::auth::logout,
            rpc::pods::list_pods,
            rpc::pods::connect_pod,
            rpc::pods::agent_info,
            rpc::pods::active_pod,
            rpc::pods::account_usage,
            rpc::fleet::list_instances,
            rpc::fleet::list_presets,
            rpc::fleet::create_instance,
            rpc::fleet::delete_instance,
            rpc::keys::list_keys,
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
            rpc::chat::watch_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running metalcraft-front");
}
