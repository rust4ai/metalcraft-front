//! The few commands that are about this machine rather than a pod or the hub.

/// Open a URL the agent wrote in the user's browser.
///
/// A transcript is full of links — a preview URL, a PR, a dashboard — and a link
/// nobody can follow is a string. The renderer cannot open one itself: an anchor
/// in the Tauri webview either does nothing (`target="_blank"`, with no window
/// handler behind it) or navigates *the app* away to the page, which is worse
/// than the string. So the click comes here instead.
///
/// **Only `http`/`https`, and no whitespace.** This ends in
/// `open`/`start`/`xdg-open`, which will happily launch a file or another app
/// for any scheme it is handed, and the text arriving here was written by a
/// model — so the scheme is checked rather than trusted.
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    let scheme_ok = {
        let lower = url.to_ascii_lowercase();
        lower.starts_with("http://") || lower.starts_with("https://")
    };
    if !scheme_ok {
        return Err("refusing to open anything but an http(s) URL".into());
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("refusing to open a URL with whitespace in it".into());
    }
    front_cloud::id::open_in_browser(&url);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn refuses_everything_that_is_not_an_http_url() {
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "/Applications/Calculator.app",
            "https://example.com --bad flag",
        ] {
            assert!(super::open_url(bad.to_string()).await.is_err(), "{bad}");
        }
    }
}
