// The MAVIN web app in a plain window of the same size as the desktop app
// (for side-by-side screenshots).  electron web-window.cjs <url>
const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1366, height: 860, title: "MAVIN (web)" });
  w.removeMenu();
  void w.loadURL(process.argv[process.argv.length - 1]);
});
app.on("window-all-closed", () => app.quit());
