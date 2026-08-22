// Release builds open a window, not a console — without this Windows shows a
// stray terminal behind the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod rpc;
mod state;

use std::sync::Arc;

use state::AppState;

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(Arc::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            rpc::auth::login_start,
            rpc::auth::login_poll,
            rpc::auth::session,
            rpc::auth::logout,
            rpc::pods::list_pods,
            rpc::pods::connect_pod,
            rpc::pods::agent_info,
            rpc::pods::active_pod,
            rpc::fleet::list_instances,
            rpc::fleet::list_presets,
            rpc::fleet::create_instance,
            rpc::fleet::delete_instance,
            rpc::chat::list_chats,
            rpc::chat::create_chat,
            rpc::chat::get_chat,
            rpc::chat::send_turn,
            rpc::chat::watch_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running metalcraft-front");
}
