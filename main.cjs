// main.cjs
const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

let mainWindow;
let devProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Always use dev server URL – even in packaged app
  mainWindow.loadURL("http://localhost:5173"); // ← CHANGE to your real Vite port (vite.config.js → server.port)
  // mainWindow.webContents.openDevTools();   // helpful for debugging

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function startDevMode() {
  // Try to find npm reliably
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

  devProcess = spawn(npmCmd, ["run", "dev"], {
    cwd: app.isPackaged
      ? path.dirname(app.getPath("exe")) // try near .exe (portable case)
      : process.cwd(),
    stdio: "inherit", // see output in console
    env: {
      ...process.env,
      NODE_ENV: "development",
      ELECTRON_RUN_AS_NODE: "1", // sometimes helps
    },
    shell: true, // needed for npm on Windows
  });

  devProcess.on("error", (err) => {
    console.error("Failed to start dev server:", err);
    if (mainWindow)
      mainWindow.webContents.executeJavaScript(`
      alert("Dev server failed to start:\\n${err.message}");
    `);
  });

  devProcess.on("close", (code) => {
    console.log(`Dev process exited with code ${code}`);
    if (mainWindow) mainWindow.close();
  });
}

app.whenReady().then(() => {
  startDevMode();

  // Ugly delay – adjust higher if your project takes longer to boot Vite + backend
  setTimeout(() => {
    createWindow();
  }, 8000); // 8 seconds – increase to 12–15s if needed

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (devProcess) devProcess.kill("SIGTERM");
  if (process.platform !== "darwin") app.quit();
});
