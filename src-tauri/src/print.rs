//! Silent printing: sends the page (print CSS applied, so only `.print-area`)
//! straight to the default printer through WebView2, without the dialog.

#[cfg(windows)]
type Reply = std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<(), String>>>>>;

#[cfg(windows)]
fn send_reply(reply: &Reply, result: Result<(), String>) {
    if let Some(tx) = reply.lock().ok().and_then(|mut g| g.take()) {
        let _ = tx.send(result);
    }
}

#[tauri::command]
pub async fn print_silent(
    webview: tauri::Webview,
    width_mm: f64,
    height_mm: f64,
    margin_mm: f64,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let reply: Reply = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
        webview
            .with_webview(move |pw| {
                if let Err(e) = unsafe { start_print(&pw, width_mm, height_mm, margin_mm, reply.clone()) } {
                    send_reply(&reply, Err(e));
                }
            })
            .map_err(|e| e.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(120), rx)
            .await
            .map_err(|_| "Printer did not respond in time.".to_string())?
            .map_err(|_| "Print was cancelled.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, width_mm, height_mm, margin_mm);
        Err("Direct printing is only available on Windows.".into())
    }
}

#[cfg(windows)]
unsafe fn start_print(
    pw: &tauri::webview::PlatformWebview,
    width_mm: f64,
    height_mm: f64,
    margin_mm: f64,
    reply: Reply,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_16, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
        COREWEBVIEW2_PRINT_STATUS_SUCCEEDED,
    };
    use webview2_com::PrintCompletedHandler;
    use windows::core::Interface;

    const MM_PER_INCH: f64 = 25.4;
    let err = |e: windows::core::Error| e.message().to_string();
    let core = pw.controller().CoreWebView2().map_err(err)?;
    let wv16: ICoreWebView2_16 = core
        .cast()
        .map_err(|_| "WebView2 runtime is too old for direct printing.".to_string())?;
    let env6: ICoreWebView2Environment6 = pw.environment().cast().map_err(err)?;

    let settings = env6.CreatePrintSettings().map_err(err)?;
    settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT).map_err(err)?;
    settings.SetPageWidth(width_mm / MM_PER_INCH).map_err(err)?;
    settings.SetPageHeight(height_mm / MM_PER_INCH).map_err(err)?;
    let m = margin_mm / MM_PER_INCH;
    settings.SetMarginTop(m).map_err(err)?;
    settings.SetMarginBottom(m).map_err(err)?;
    settings.SetMarginLeft(m).map_err(err)?;
    settings.SetMarginRight(m).map_err(err)?;
    settings.SetShouldPrintBackgrounds(true).map_err(err)?;
    settings.SetShouldPrintHeaderAndFooter(false).map_err(err)?;

    let handler = PrintCompletedHandler::create(Box::new(move |hr, status| {
        let result = if let Err(e) = hr {
            Err(e.message().to_string())
        } else if status == COREWEBVIEW2_PRINT_STATUS_SUCCEEDED {
            Ok(())
        } else {
            Err("Printer is not available. Check the default printer in Windows settings.".to_string())
        };
        send_reply(&reply, result);
        Ok(())
    }));
    wv16.Print(&settings, &handler).map_err(err)
}
