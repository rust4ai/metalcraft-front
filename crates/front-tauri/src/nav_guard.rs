//! The last line between a link and a lost window.
//!
//! The renderer sends outward links to the browser itself (`installExternalLinkHandler`
//! in the frontend), but a click is not the only way a webview navigates: a
//! `window.location =`, a form, a redirect out of a page we did load. Any of them
//! replaces the app with a web page, and there is no back button on this window —
//! the shell, the open session and the pod socket are simply gone.
//!
//! So the same rule is enforced one level down, where nothing in the page can
//! route around it: anything that is not *this app's own document* is cancelled
//! and handed to the real browser instead.

use tauri::{
    Runtime, Url,
    plugin::{Builder, TauriPlugin},
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nav-guard")
        .on_navigation(|_webview, url| {
            if is_own_page(url) {
                return true;
            }
            log::info!("navigation to {url} sent to the browser instead of the window");
            front_cloud::id::open_in_browser(url.as_str());
            false
        })
        .build()
}

/// Is this the app's own page, rather than somewhere out on the web?
///
/// The bundle is served over `tauri://` (macOS/Linux), `http://tauri.localhost`
/// (Windows) or `http://localhost:5173` (the dev server), so the test is the
/// origin, not the scheme alone. Everything else — including a `mailto:` the
/// browser handles better than we do — leaves.
fn is_own_page(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "::1" | "[::1]" | "tauri.localhost" | "ipc.localhost")
        ),
        // tauri:, asset:, about:blank, blob:, data: — the app rendering itself.
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::is_own_page;
    use tauri::Url;

    fn own(url: &str) -> bool {
        is_own_page(&Url::parse(url).unwrap())
    }

    #[test]
    fn the_app_still_loads_itself() {
        assert!(own("tauri://localhost/index.html"));
        assert!(own("http://tauri.localhost/index.html"));
        assert!(own("http://localhost:5173/"));
        assert!(own("http://127.0.0.1:1421/rpc"));
        assert!(own("about:blank"));
    }

    #[test]
    fn a_page_on_the_web_does_not_take_the_window() {
        assert!(!own("https://2rycrfq356gm.livepreview.space/"));
        assert!(!own("https://github.com/rust4ai/metalcraft-front"));
        assert!(!own("http://packs.metalcraftai.com/@mnote"));
    }
}
