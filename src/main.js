// Electron main process entrypoint. Responsibilities:
// - Enforce single-instance behavior
// - Create and manage the Preloader and Main windows
// - Bridge IPC between renderer and back-end managers
// - Fan-out broadcast events to the UI (webContents.send guards everywhere)
const { app, BrowserWindow, ipcMain: RPC, Menu } = require('electron/main');
// Use Electron's shell for opening folders/URLs instead of spawning platform-specific commands
const {
  shell,
  dialog,
  powerMonitor,
  powerSaveBlocker,
  autoUpdater: nativeAutoUpdater,
} = require('electron');
if (require('electron-squirrel-startup')) app.quit();

const { Manager: AppDataManager } = require('./Modules/AppData');
AppDataManager.Initialize();
const { CreateLogger } = require('./Modules/Logger');
const Logger = CreateLogger('Main');
// Gate multiple instances. If another instance is already running, quit early.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  Logger.error('Another instance of ShowTrak Flow is already running. Exiting this instance.');
  app.quit();
  process.exit(0);
} else {
  Logger.log('Single instance lock acquired');
}

const { Config } = require('./Modules/Config');
// Server module hosts the HTTP/Socket.IO Web UI and mirrors OSC routes to HTTP.
require('./Modules/Server');
const { Manager: BonjourManager } = require('./Modules/Bonjour');
BonjourManager.Init();
const { Manager: DBManager } = require('./Modules/DB');
const { Manager: AlertsManager } = require('./Modules/AlertsManager');
const { Manager: FileSelectorManager } = require('./Modules/FileSelectorManager');
const { Manager: BackupManager } = require('./Modules/BackupManager');
const { Manager: BroadcastManager } = require('./Modules/Broadcast');
const { Manager: SettingsManager } = require('./Modules/SettingsManager');
const { Manager: IPCValidation } = require('./Modules/IPCValidation');
const { Manager: FlowGroupsManager } = require('./Modules/FlowGroupsManager');
const { Manager: SceneManager } = require('./Modules/SceneManager');
const { Manager: QueueManager } = require('./Modules/QueueManager');
const { Manager: FlagManager } = require('./Modules/FlagManager');
const { Manager: RemoteUsersManager } = require('./Modules/RemoteUsersManager');
const { Manager: ShowColoursManager } = require('./Modules/ShowColoursManager');
const { Manager: ChatRoomsManager } = require('./Modules/ChatRoomsManager');
const { OSC } = require('./Modules/OSC');
const { Manager: ModeManager } = require('./Modules/ModeManager');
const { Wait } = require('./Modules/Utils');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { Manager: AppUpdater } = require('./main/app-updater');

const BASE_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
});
const WINDOW_DRAGBAR_HEIGHT_PX = 32;
const MAC_TRAFFIC_LIGHT_DIAMETER_PX = 12;
const MAC_TRAFFIC_LIGHT_LEFT_PADDING_PX = 12;
const MAC_TRAFFIC_LIGHT_TOP_PADDING_PX = Math.max(
  0,
  Math.round((WINDOW_DRAGBAR_HEIGHT_PX - MAC_TRAFFIC_LIGHT_DIAMETER_PX) / 2)
);

const WINDOW_CHROME_OPTIONS =
  process.platform === 'darwin'
    ? {
        frame: true,
        titleBarStyle: 'hidden',
        trafficLightPosition: {
          x: MAC_TRAFFIC_LIGHT_LEFT_PADDING_PX,
          y: MAC_TRAFFIC_LIGHT_TOP_PADDING_PX,
        },
      }
    : {
        frame: true,
        titleBarStyle: 'hidden',
      };

function sendShowFileUpdated(filePath) {
  try {
    if (MainWindow && !MainWindow.isDestroyed()) {
      MainWindow.webContents.send('ShowFileUpdated', filePath || null);
    }
  } catch {
    // Window may be mid-teardown; navbar update is non-critical.
  }
}

function sendMainWindowFullscreenChanged(isFullscreen) {
  try {
    if (MainWindow && !MainWindow.isDestroyed()) {
      MainWindow.webContents.send('MainWindowFullscreenChanged', Boolean(isFullscreen));
    }
  } catch {
    // Non-critical UI sync; ignore transient teardown errors.
  }
}

function getWindowIconPath() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(__dirname, 'images', iconName);
}

function validationErrorTuple(error, fallback = null) {
  const message = error && error.message ? error.message : String(error || 'Invalid request');
  return [message, fallback];
}

function applyWindowSecurityGuards(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) return;

  windowInstance.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url);
      }
    } catch (_error) {
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  windowInstance.webContents.on('will-navigate', (event, url) => {
    const currentURL = windowInstance.webContents.getURL();
    if (!currentURL || !url) return;
    if (url !== currentURL) {
      event.preventDefault();
    }
  });
}

// Main UI window. Always check isDestroyed() before using.
var MainWindow = null;
let mainWindowCloseApproved = false;
let closePromptInFlight = false;
let quitRequested = false;
let accidentalShutdownProtectionEnabled = false;
let bypassShutdownConfirmation = false;
let shutdownCleanupInFlight = false;
let shutdownCleanupComplete = false;
let quittingForUpdate = false;
let SceneTimerHeartbeat = null;

function hasMainWindow() {
  return MainWindow && !MainWindow.isDestroyed();
}

function sendAppMenuAction(actionID) {
  try {
    if (hasMainWindow()) {
      MainWindow.webContents.send('AppMenuAction', String(actionID || ''));
    }
  } catch {
    // Best-effort UI action dispatch; ignore teardown races.
  }
}

function buildMacAppMenuTemplate() {
  const fileSubmenu = [
    { label: 'New Show', accelerator: 'CmdOrCtrl+N', click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_NEW') },
    { label: 'Open', accelerator: 'CmdOrCtrl+O', click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_OPEN') },
    { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_SAVE') },
    {
      label: 'Save As',
      accelerator: 'CmdOrCtrl+Shift+S',
      click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_SAVEAS'),
    },
    { type: 'separator' },
    { label: 'Open Logs Directory', click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_LOGSFOLDER') },
    { type: 'separator' },
    {
      label: 'OSC/API Reference',
      click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_OSC_ROUTE_LIST_BUTTON'),
    },
    {
      label: 'OSC/API Debug Terminal',
      click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_OSC_HTTP_DEBUG_BUTTON'),
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_CHECKUPDATES'),
    },
    { label: 'About', click: () => sendAppMenuAction('SHOWTRAK_ABOUT_BUTTON') },
    { type: 'separator' },
    {
      label: 'ShowTrak Preferences',
      accelerator: 'CmdOrCtrl+,',
      click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_OPEN_SETTINGS'),
    },
    {
      label: 'Close ShowTrak',
      click: () => sendAppMenuAction('SHOWTRAK_MODEL_CORE_SHUTDOWN_BUTTON'),
    },
  ];

  return [
    { role: 'appMenu' },
    { label: 'File', submenu: fileSubmenu },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}

function configureApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  const menu = Menu.buildFromTemplate(buildMacAppMenuTemplate());
  Menu.setApplicationMenu(menu);
}

async function PromptConfirmBeforeShutdown() {
  if (quittingForUpdate) {
    return true;
  }

  const shouldConfirmShutdown =
    accidentalShutdownProtectionEnabled &&
    ModeManager.Get() === 'SHOW' &&
    !bypassShutdownConfirmation;

  if (!shouldConfirmShutdown) {
    return true;
  }

  const parentWindow = hasMainWindow() ? MainWindow : null;
  const { response } = await dialog.showMessageBox(parentWindow, {
    type: 'question',
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: 'Close ShowTrak Flow?',
    detail: 'You are currently in show mode, are you sure you want to close?',
  });

  return response === 0;
}

async function PromptSaveBeforeClose() {
  const currentFilePath = BackupManager.GetCurrentFilePath();
  const hasNeverBeenSaved = !currentFilePath;
  const hasUnsavedChanges =
    typeof BackupManager.HasUnsavedChanges === 'function'
      ? await BackupManager.HasUnsavedChanges()
      : false;

  if (!hasNeverBeenSaved && !hasUnsavedChanges) {
    return true;
  }

  const { response } = await dialog.showMessageBox(MainWindow, {
    type: 'question',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: 'You have unsaved show changes.',
    detail: 'Save changes before closing ShowTrak?',
  });

  if (response === 2) return false;
  if (response === 1) return true;

  let SavePath = currentFilePath;
  if (!SavePath) {
    const { canceled, filePath } = await FileSelectorManager.SaveDialog('Save ShowTrak File As');
    if (canceled || !filePath) return false;
    SavePath = filePath;
  }

  const [Err] = await BackupManager.Save(SavePath);
  if (Err) {
    Logger.error('Failed to save show during shutdown:', Err);
    dialog.showErrorBox('Unable to Save Show', String(Err));
    return false;
  }

  sendShowFileUpdated(BackupManager.GetCurrentFilePath());
  return true;
}

let PreloaderWindow = null;
app.whenReady().then(async () => {
  if (require('electron-squirrel-startup')) return app.quit();

  configureApplicationMenu();

  if (MainWindow) {
    MainWindow.close();
    MainWindow = null;
  }

  accidentalShutdownProtectionEnabled = await SettingsManager.GetValue(
    'SYSTEM_CONFIRM_SHUTDOWN_ON_ALT_F4'
  );

  // Lightweight splash that keeps the app responsive while heavy init finishes
  PreloaderWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#161618',
    width: 400,
    height: 500,
    resizable: false,
    webPreferences: {
      ...BASE_WEB_PREFERENCES,
      preload: path.join(__dirname, 'bridge_preloader.js'),
      devTools: !app.isPackaged,
    },
    icon: getWindowIconPath(),
    ...WINDOW_CHROME_OPTIONS,
  });

  PreloaderWindow.once('ready-to-show', () => {
    PreloaderWindow.show();
  });

  PreloaderWindow.loadFile(path.join(__dirname, 'UI', 'preloader.html'));
  applyWindowSecurityGuards(PreloaderWindow);

  // Primary UI window. Defer showing until UI is loaded to avoid white flash.
  MainWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#161618',
    width: 1515,
    height: 940,
    minWidth: 815,
    minHeight: 600,
    webPreferences: {
      ...BASE_WEB_PREFERENCES,
      preload: path.join(__dirname, 'bridge_main.js'),
      devTools: !app.isPackaged,
    },
    icon: getWindowIconPath(),
    ...WINDOW_CHROME_OPTIONS,
  });

  MainWindow.loadFile(path.join(__dirname, 'UI', 'index.html')).then(async () => {
    Logger.log('MainWindow finished loading UI');
    sendMainWindowFullscreenChanged(MainWindow.isFullScreen());
    AlertsManager.Init().catch((Err) => Logger.error('Failed to init AlertsManager:', Err));
    FlowGroupsManager.Init().catch((Err) => Logger.error('Failed to init FlowGroupsManager:', Err));
    SceneManager.Init().catch((Err) => Logger.error('Failed to init SceneManager:', Err));
    QueueManager.Init().catch((Err) => Logger.error('Failed to init QueueManager:', Err));
    FlagManager.Init().catch((Err) => Logger.error('Failed to init FlagManager:', Err));
    RemoteUsersManager.Init().catch((Err) =>
      Logger.error('Failed to init RemoteUsersManager:', Err)
    );
    ShowColoursManager.Init().catch((Err) => Logger.error('Failed to init ShowColoursManager:', Err));
    ChatRoomsManager.Init().catch((Err) => Logger.error('Failed to init ChatRoomsManager:', Err));
    await Wait(800);
    PreloaderWindow.close();
    MainWindow.show();
  });
  applyWindowSecurityGuards(MainWindow);
  MainWindow.on('close', async (event) => {
    if (mainWindowCloseApproved || quittingForUpdate) return;
    event.preventDefault();
    if (closePromptInFlight) return;

    closePromptInFlight = true;
    try {
      const shouldProceedWithShutdown = await PromptConfirmBeforeShutdown();
      if (!shouldProceedWithShutdown) {
        quitRequested = false;
        return;
      }

      const shouldClose = await PromptSaveBeforeClose();
      if (!shouldClose) {
        quitRequested = false;
        return;
      }

      mainWindowCloseApproved = true;
      if (quitRequested) {
        app.quit();
        return;
      }
      MainWindow.close();
    } catch (Err) {
      Logger.error('Unexpected error while prompting to save before close:', Err);
    } finally {
      closePromptInFlight = false;
    }
  });
  MainWindow.on('closed', () => {
    mainWindowCloseApproved = false;
    bypassShutdownConfirmation = false;
    MainWindow = null;
  });
  MainWindow.on('enter-full-screen', () => sendMainWindowFullscreenChanged(true));
  MainWindow.on('leave-full-screen', () => sendMainWindowFullscreenChanged(false));

  // ShowTrak file save/open IPC. Returns [err, result] tuples consistently.
  RPC.handle('Show:Save', async () => {
    let CurrentPath = BackupManager.GetCurrentFilePath();
    if (!CurrentPath) {
      // No file opened or saved yet this session — fall back to Save As.
      let { canceled, filePath } = await FileSelectorManager.SaveDialog('Save ShowTrak File As');
      if (canceled || !filePath) {
        Logger.log('Show:Save canceled');
        return ['Cancelled By User', null];
      }
      CurrentPath = filePath;
    }
    Logger.log('Saving ShowTrak file to:', CurrentPath);
    let [Err, Result] = await BackupManager.Save(CurrentPath);
    if (Err) return [Err, null];
    sendShowFileUpdated(BackupManager.GetCurrentFilePath());
    return [null, Result];
  });

  RPC.handle('Show:SaveAs', async () => {
    let { canceled, filePath } = await FileSelectorManager.SaveDialog('Save ShowTrak File As');
    if (canceled || !filePath) {
      Logger.log('Show:SaveAs canceled');
      return ['Cancelled By User', null];
    }
    Logger.log('Saving ShowTrak file to:', filePath);
    let [Err, Result] = await BackupManager.Save(filePath);
    if (Err) return [Err, null];
    sendShowFileUpdated(BackupManager.GetCurrentFilePath());
    return [null, Result];
  });

  RPC.handle('Show:Open', async () => {
    let { canceled, filePaths } = await FileSelectorManager.OpenDialog('Open ShowTrak File');
    if (canceled || !filePaths || filePaths.length === 0) {
      Logger.log('Show:Open canceled');
      return ['Cancelled By User', null];
    }
    Logger.log('Opening ShowTrak file from:', filePaths[0]);
    let [Err, Result] = await BackupManager.Open(filePaths[0]);
    if (Err) return [Err, null];
    sendShowFileUpdated(BackupManager.GetCurrentFilePath());
    return [null, Result];
  });

  RPC.handle('Show:GetCurrentFile', async () => {
    return BackupManager.GetCurrentFilePath();
  });

  RPC.handle('Show:HasUnsavedData', async () => {
    return await BackupManager.HasUnsavedWorkingData();
  });

  RPC.handle('Show:EnsureFileExists', async () => {
    let [Err, Result] = await BackupManager.EnsureCurrentFileExists();
    if (Err) return [Err, null];
    if (Result && Result.Missing) sendShowFileUpdated(BackupManager.GetCurrentFilePath());
    return [null, Result];
  });

  RPC.handle('Show:New', async () => {
    Logger.log('Creating new ShowTrak show');
    let [Err, Result] = await BackupManager.New();
    if (Err) return [Err, null];
    sendShowFileUpdated(BackupManager.GetCurrentFilePath());
    return [null, Result];
  });
  // App self-update flows (dev simulation, Squirrel, electron-updater) are
  // encapsulated in the AppUpdater module. It registers the AppUpdate:* IPC
  // handlers and performs the eager electron-updater init.
  AppUpdater.Register(RPC, { getMainWindow: () => MainWindow });

  RPC.handle('Config:Get', async () => {
    return Config;
  });

  // Provide a list of Web UI addresses on the local network with port
  RPC.handle('WebUI:GetAddresses', async () => {
    try {
      const port =
        Config && Config.Application && Config.Application.Port ? Config.Application.Port : 3000;
      const hostname = os.hostname();
      const net = os.networkInterfaces() || {};
      const hosts = new Set();
      const push = (h) => {
        if (!h) return;
        try {
          h = String(h).trim();
        } catch {}
        if (!h) return;
        hosts.add(h);
      };
      push('localhost');
      push('127.0.0.1');
      push(hostname);
      for (const key of Object.keys(net)) {
        const list = net[key] || [];
        for (const addr of list) {
          if (!addr) continue;
          const family =
            addr.family || (addr.address && addr.address.includes(':')) ? 'IPv6' : 'IPv4';
          if (family !== 'IPv4') continue;
          if (addr.internal) continue;
          push(addr.address);
        }
      }
      const urls = Array.from(hosts).map((host) => ({ host, url: `http://${host}:${port}/` }));
      return { port, hostname, urls };
    } catch (e) {
      return {
        port: 3000,
        hostname: os.hostname(),
        urls: [{ host: 'localhost', url: 'http://localhost:3000/' }],
      };
    }
  });

  // Application Mode IPC
  RPC.handle('Mode:Get', async () => {
    return ModeManager.Get();
  });

  RPC.handle('Mode:Set', async (_event, NewMode) => {
    const Updated = ModeManager.Set(NewMode);
    return Updated;
  });

  RPC.handle('Settings:Get', async () => {
    let Settings = await SettingsManager.GetAll();
    return Settings;
  });

  // ---- Alert Rules ----
  RPC.handle('GetAlertTriggers', async () => {
    return AlertsManager.GetTriggers();
  });

  RPC.handle('GetAlertActionTypes', async () => {
    return AlertsManager.GetActionTypes();
  });

  RPC.handle('GetAllAlertRules', async () => {
    const [Err, Rules] = await AlertsManager.GetAll();
    if (Err) return [];
    return Rules || [];
  });

  RPC.handle('GetAlertRule', async (_Event, RuleID) => {
    try {
      RuleID = IPCValidation.AlertRuleID(RuleID);
    } catch {
      return null;
    }
    const [Err, Rule] = await AlertsManager.Get(RuleID);
    if (Err) return null;
    return Rule;
  });

  RPC.handle('CreateAlertRule', async (_Event, Payload) => {
    try {
      Payload = IPCValidation.AlertRuleCreatePayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Rule] = await AlertsManager.Create(Payload);
    if (Err) return [Err, null];
    return [null, Rule];
  });

  RPC.handle('UpdateAlertRule', async (_Event, RuleID, Payload) => {
    try {
      RuleID = IPCValidation.AlertRuleID(RuleID);
      Payload = IPCValidation.AlertRuleUpdatePayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Rule] = await AlertsManager.Update(RuleID, Payload);
    if (Err) return [Err, null];
    return [null, Rule];
  });

  RPC.handle('DeleteAlertRule', async (_Event, RuleID) => {
    try {
      RuleID = IPCValidation.AlertRuleID(RuleID);
    } catch (error) {
      return validationErrorTuple(error, false);
    }
    const [Err, Result] = await AlertsManager.Delete(RuleID);
    if (Err) return [Err, null];
    return [null, Result];
  });

  RPC.handle('SetAlertRuleEnabled', async (_Event, RuleID, Enabled) => {
    try {
      RuleID = IPCValidation.AlertRuleID(RuleID);
      Enabled = !!Enabled;
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Rule] = await AlertsManager.SetEnabled(RuleID, Enabled);
    if (Err) return [Err, null];
    return [null, Rule];
  });

  RPC.handle('AlertActionsEnabled:Get', async () => {
    return AlertsManager.GetActionsEnabled();
  });

  RPC.handle('AlertActionsEnabled:Set', async (_Event, Enabled) => {
    return AlertsManager.SetActionsEnabled(!!Enabled);
  });

  // ---- Flows ----
  RPC.handle('Flow:GetAll', async () => {
    const [Err, Flows] = await FlowGroupsManager.GetAllFlows();
    if (Err) return [];
    return Flows || [];
  });

  RPC.handle('Flow:Get', async (_Event, FlowID) => {
    try {
      FlowID = IPCValidation.FlowID(FlowID);
    } catch {
      return null;
    }
    const [Err, Flow] = await FlowGroupsManager.GetFlowWithGroups(FlowID);
    if (Err) return null;
    return Flow;
  });

  RPC.handle('Flow:Create', async (_Event, Payload) => {
    try {
      Payload = IPCValidation.FlowPayload(Payload);
      if (!Payload.Label) throw new Error('Flow label is required');
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Flow] = await FlowGroupsManager.CreateFlow(Payload);
    if (Err) return [Err, null];
    return [null, Flow];
  });

  RPC.handle('Flow:Update', async (_Event, FlowID, Payload) => {
    try {
      FlowID = IPCValidation.FlowID(FlowID);
      Payload = IPCValidation.FlowPayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Flow] = await FlowGroupsManager.UpdateFlow(FlowID, Payload);
    if (Err) return [Err, null];
    return [null, Flow];
  });

  RPC.handle('Flow:Delete', async (_Event, FlowID) => {
    try {
      FlowID = IPCValidation.FlowID(FlowID);
    } catch (error) {
      return validationErrorTuple(error, false);
    }
    const [Err, Result] = await FlowGroupsManager.DeleteFlow(FlowID);
    if (Err) return [Err, null];
    return [null, Result];
  });

  RPC.handle('Flow:SetOrder', async (_Event, OrderedFlowIDs) => {
    try {
      OrderedFlowIDs = IPCValidation.FlowIDList(OrderedFlowIDs);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Flows] = await FlowGroupsManager.SetFlowOrder(OrderedFlowIDs);
    if (Err) return [Err, null];
    return [null, Flows];
  });

  // ---- Flow Groups ----
  RPC.handle('Flow:GetGroups', async (_Event, FlowID) => {
    try {
      FlowID = IPCValidation.FlowID(FlowID);
    } catch {
      return [];
    }
    const [Err, Groups] = await FlowGroupsManager.GetGroups(FlowID);
    if (Err) return [];
    return Groups || [];
  });

  RPC.handle('Flow:CreateGroup', async (_Event, FlowID, Payload) => {
    try {
      FlowID = IPCValidation.FlowID(FlowID);
      Payload = IPCValidation.FlowGroupPayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Group] = await FlowGroupsManager.CreateGroup(FlowID, Payload);
    if (Err) return [Err, null];
    return [null, Group];
  });

  RPC.handle('Flow:UpdateGroup', async (_Event, RowID, Payload) => {
    try {
      RowID = IPCValidation.FlowGroupRowID(RowID);
      Payload = IPCValidation.FlowGroupPayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Group] = await FlowGroupsManager.UpdateGroup(RowID, Payload);
    if (Err) return [Err, null];
    return [null, Group];
  });

  RPC.handle('Flow:DeleteGroup', async (_Event, RowID) => {
    try {
      RowID = IPCValidation.FlowGroupRowID(RowID);
    } catch (error) {
      return validationErrorTuple(error, false);
    }
    const [Err, Result] = await FlowGroupsManager.DeleteGroup(RowID);
    if (Err) return [Err, null];
    return [null, Result];
  });

  RPC.handle('Flow:SetGroupOrder', async (_Event, FlowID, OrderedRowIDs) => {
    try {
      FlowID = IPCValidation.FlowID(FlowID);
      OrderedRowIDs = IPCValidation.FlowGroupRowIDList(OrderedRowIDs);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Groups] = await FlowGroupsManager.SetGroupOrder(FlowID, OrderedRowIDs);
    if (Err) return [Err, null];
    return [null, Groups];
  });

  // ---- Queue (Active Show) ----
  RPC.handle('Queue:GetAll', async () => {
    const [Err, Queue] = await QueueManager.GetAll();
    if (Err) return [];
    return Queue || [];
  });

  RPC.handle('Queue:LoadFlow', async (_Event, FlowID) => {
    try {
      FlowID = IPCValidation.FlowID(FlowID);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Queue] = await QueueManager.LoadFlow(FlowID);
    if (Err) return [Err, null];
    return [null, Queue];
  });

  RPC.handle('Queue:AddGroup', async (_Event, Payload) => {
    try {
      Payload = IPCValidation.QueueGroupPayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Group] = await QueueManager.AddGroup(Payload);
    if (Err) return [Err, null];
    return [null, Group];
  });

  RPC.handle('Queue:UpdateGroup', async (_Event, InstanceID, Payload) => {
    try {
      InstanceID = IPCValidation.QueueInstanceID(InstanceID);
      Payload = IPCValidation.QueueGroupPayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Group] = await QueueManager.UpdateGroup(InstanceID, Payload);
    if (Err) return [Err, null];
    return [null, Group];
  });

  RPC.handle('Queue:DeleteGroup', async (_Event, InstanceID) => {
    try {
      InstanceID = IPCValidation.QueueInstanceID(InstanceID);
    } catch (error) {
      return validationErrorTuple(error, false);
    }
    const [Err, Result] = await QueueManager.DeleteGroup(InstanceID);
    if (Err) return [Err, null];
    return [null, Result];
  });

  RPC.handle('Queue:SetOrder', async (_Event, OrderedInstanceIDs) => {
    try {
      OrderedInstanceIDs = IPCValidation.QueueInstanceIDList(OrderedInstanceIDs);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Queue] = await QueueManager.SetOrder(OrderedInstanceIDs);
    if (Err) return [Err, null];
    return [null, Queue];
  });

  RPC.handle('Queue:SetLocation', async (_Event, InstanceID, Location, SceneID) => {
    try {
      InstanceID = IPCValidation.QueueInstanceID(InstanceID);
      Location = IPCValidation.QueueLocation(Location);
      SceneID = SceneID == null ? null : IPCValidation.SceneID(SceneID);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Group] = await QueueManager.SetLocation(InstanceID, Location, SceneID);
    if (Err) return [Err, null];
    return [null, Group];
  });

  RPC.handle('Queue:Reset', async () => {
    const [Err, Result] = await QueueManager.Reset();
    if (Err) return [Err, null];
    return [null, Result];
  });

  // ---- Scenes ----
  RPC.handle('Scene:GetAll', async () => {
    const [Err, Scenes] = await SceneManager.GetAll();
    if (Err) return [];
    return Scenes || [];
  });

  RPC.handle('Scene:Create', async (_Event, Payload) => {
    try {
      Payload = IPCValidation.ScenePayload(Payload);
      if (!Payload.Label) throw new Error('Scene label is required');
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Scene] = await SceneManager.Create(Payload);
    if (Err) return [Err, null];
    return [null, Scene];
  });

  RPC.handle('Scene:Update', async (_Event, SceneID, Payload) => {
    try {
      SceneID = IPCValidation.SceneID(SceneID);
      Payload = IPCValidation.ScenePayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Scene] = await SceneManager.Update(SceneID, Payload);
    if (Err) return [Err, null];
    return [null, Scene];
  });

  RPC.handle('Scene:Delete', async (_Event, SceneID) => {
    try {
      SceneID = IPCValidation.SceneID(SceneID);
    } catch (error) {
      return validationErrorTuple(error, false);
    }
    const [Err, Result] = await SceneManager.Delete(SceneID);
    if (Err) return [Err, null];
    return [null, Result];
  });

  RPC.handle('Scene:SetOrder', async (_Event, OrderedSceneIDs) => {
    try {
      OrderedSceneIDs = IPCValidation.SceneIDList(OrderedSceneIDs);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Scenes] = await SceneManager.SetOrder(OrderedSceneIDs);
    if (Err) return [Err, null];
    return [null, Scenes];
  });

  RPC.handle('Scene:StartTimer', async (_Event, SceneID) => {
    try {
      SceneID = IPCValidation.SceneID(SceneID);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Scene] = await SceneManager.StartTimer(SceneID);
    if (Err) return [Err, null];
    return [null, Scene];
  });

  // ---- Flag Definitions (Show Settings) ----
  RPC.handle('Flag:GetAll', async () => {
    const [Err, Flags] = await FlagManager.GetAll();
    if (Err) return [];
    return Flags || [];
  });

  RPC.handle('Flag:Create', async (_Event, Payload) => {
    try {
      Payload = IPCValidation.FlagPayload(Payload);
      if (!Payload.Label) throw new Error('Flag label is required');
      if (!Payload.Icon) throw new Error('Flag icon is required');
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Flag] = await FlagManager.Create(Payload);
    if (Err) return [Err, null];
    return [null, Flag];
  });

  RPC.handle('Flag:Update', async (_Event, FlagID, Payload) => {
    try {
      FlagID = IPCValidation.FlagID(FlagID);
      Payload = IPCValidation.FlagPayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Flag] = await FlagManager.Update(FlagID, Payload);
    if (Err) return [Err, null];
    return [null, Flag];
  });

  RPC.handle('Flag:Delete', async (_Event, FlagID) => {
    try {
      FlagID = IPCValidation.FlagID(FlagID);
    } catch (error) {
      return validationErrorTuple(error, false);
    }
    const [Err, Result] = await FlagManager.Delete(FlagID);
    if (Err) return [Err, null];
    return [null, Result];
  });

  RPC.handle('Flag:SetOrder', async (_Event, OrderedFlagIDs) => {
    try {
      OrderedFlagIDs = IPCValidation.FlagIDList(OrderedFlagIDs);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Flags] = await FlagManager.SetOrder(OrderedFlagIDs);
    if (Err) return [Err, null];
    return [null, Flags];
  });

  // ---- Remote Users (Show Settings) ----
  RPC.handle('RemoteUser:GetAll', async () => {
    const [Err, Users] = await RemoteUsersManager.GetAll();
    if (Err) return [];
    return Users || [];
  });

  RPC.handle('RemoteUser:Create', async (_Event, Payload) => {
    try {
      Payload = IPCValidation.RemoteUserPayload(Payload);
      if (!Payload.Username) throw new Error('Username is required');
      if (!Payload.Pin) throw new Error('PIN is required');
      if (!Payload.Icon) throw new Error('Icon is required');
      if (!Payload.Colour) throw new Error('Colour is required');
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, User] = await RemoteUsersManager.Create(Payload);
    if (Err) return [Err, null];
    return [null, User];
  });

  RPC.handle('RemoteUser:Update', async (_Event, RemoteUserID, Payload) => {
    try {
      RemoteUserID = IPCValidation.RemoteUserID(RemoteUserID);
      Payload = IPCValidation.RemoteUserPayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, User] = await RemoteUsersManager.Update(RemoteUserID, Payload);
    if (Err) return [Err, null];
    return [null, User];
  });

  RPC.handle('RemoteUser:Delete', async (_Event, RemoteUserID) => {
    try {
      RemoteUserID = IPCValidation.RemoteUserID(RemoteUserID);
    } catch (error) {
      return validationErrorTuple(error, false);
    }
    const [Err, Result] = await RemoteUsersManager.Delete(RemoteUserID);
    if (Err) return [Err, null];
    return [null, Result];
  });

  // ---- Show Colours (Show Settings) ----
  RPC.handle('ShowColour:GetAll', async () => {
    const [Err, Colours] = await ShowColoursManager.GetAll();
    if (Err) return [];
    return Colours || [];
  });

  RPC.handle('ShowColour:Create', async (_Event, Payload) => {
    try {
      Payload = IPCValidation.ShowColourPayload(Payload);
      if (!Payload.Label) throw new Error('Show colour label is required');
      if (!Payload.Colour) throw new Error('Show colour hex code is required');
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Colour] = await ShowColoursManager.Create(Payload);
    if (Err) return [Err, null];
    return [null, Colour];
  });

  RPC.handle('ShowColour:Update', async (_Event, ShowColourID, Payload) => {
    try {
      ShowColourID = IPCValidation.ShowColourID(ShowColourID);
      Payload = IPCValidation.ShowColourPayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Colour] = await ShowColoursManager.Update(ShowColourID, Payload);
    if (Err) return [Err, null];
    return [null, Colour];
  });

  RPC.handle('ShowColour:Delete', async (_Event, ShowColourID) => {
    try {
      ShowColourID = IPCValidation.ShowColourID(ShowColourID);
    } catch (error) {
      return validationErrorTuple(error, false);
    }
    const [Err, Result] = await ShowColoursManager.Delete(ShowColourID);
    if (Err) return [Err, null];
    return [null, Result];
  });

  RPC.handle('ShowColour:ResetDefaults', async () => {
    const [Err, Colours] = await ShowColoursManager.ResetToDefaults();
    if (Err) return [Err, null];
    return [null, Colours];
  });

  // ---- Chat Rooms ----
  RPC.handle('ChatRoom:GetAll', async () => {
    const [Err, Rooms] = await ChatRoomsManager.GetAllRooms();
    if (Err) return [];
    return Rooms || [];
  });

  RPC.handle('ChatRoom:GetMessages', async (_Event, RoomType, RoomID) => {
    try {
      RoomType = IPCValidation.ChatRoomType(RoomType);
      RoomID = Number(RoomID);
      if (!Number.isInteger(RoomID) || RoomID <= 0) throw new Error('Room ID must be a positive integer');
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Messages] = await ChatRoomsManager.GetMessages(RoomType, RoomID);
    if (Err) return [Err, null];
    return [null, Messages || []];
  });

  RPC.handle('ChatRoom:SendMessage', async (_Event, RoomType, RoomID, Message) => {
    try {
      RoomType = IPCValidation.ChatRoomType(RoomType);
      RoomID = Number(RoomID);
      if (!Number.isInteger(RoomID) || RoomID <= 0) throw new Error('Room ID must be a positive integer');
      Message = IPCValidation.ChatMessageText(Message);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Result] = await ChatRoomsManager.SendControlMessage(RoomType, RoomID, Message);
    if (Err) return [Err, null];
    return [null, Result];
  });

  RPC.handle('ChatRoom:CreateCustom', async (_Event, Payload) => {
    try {
      Payload = IPCValidation.CustomChatRoomPayload(Payload);
      if (!Payload.Label) throw new Error('Chat room label is required');
      if (!Payload.Colour) throw new Error('Chat room colour is required');
      if (!Payload.Icon) throw new Error('Chat room icon is required');
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Room] = await ChatRoomsManager.CreateCustomRoom(Payload);
    if (Err) return [Err, null];
    return [null, Room];
  });

  RPC.handle('ChatRoom:UpdateCustom', async (_Event, RoomID, Payload) => {
    try {
      RoomID = Number(RoomID);
      if (!Number.isInteger(RoomID) || RoomID <= 0) throw new Error('Room ID must be a positive integer');
      Payload = IPCValidation.CustomChatRoomPayload(Payload);
    } catch (error) {
      return validationErrorTuple(error);
    }
    const [Err, Room] = await ChatRoomsManager.UpdateCustomRoom(RoomID, Payload);
    if (Err) return [Err, null];
    return [null, Room];
  });

  RPC.handle('ChatRoom:DeleteCustom', async (_Event, RoomID) => {
    try {
      RoomID = Number(RoomID);
      if (!Number.isInteger(RoomID) || RoomID <= 0) throw new Error('Room ID must be a positive integer');
    } catch (error) {
      return validationErrorTuple(error, false);
    }
    const [Err, Result] = await ChatRoomsManager.DeleteCustomRoom(RoomID);
    if (Err) return [Err, null];
    return [null, Result];
  });

  // Renderer signaled it (re)loaded: push the current authoritative state.
  RPC.handle('Loaded', async () => {
    Logger.log('Application Page Hot Reloaded');
    await UpdateSettings();
    await UpdateOSCList();
    await UpdateAlertRuleList();
    await UpdateFlowList();
    await UpdateQueue();
    await UpdateSceneList();
    await UpdateFlagList();
    await UpdateRemoteUserList();
    await UpdateShowColourList();
    await UpdateChatRoomList();
    // Push current application mode to renderer on initial load
    if (MainWindow && !MainWindow.isDestroyed()) {
      MainWindow.webContents.send('ModeUpdated', ModeManager.Get());
    }
    return;
  });

  async function Shutdown({ bypassAccidentalConfirmation = true } = {}) {
    Logger.log('Application shutdown requested');
    bypassShutdownConfirmation = bypassAccidentalConfirmation;
    quitRequested = true;
    app.quit();
    return;
  }

  RPC.handle('Shutdown', async (_event, Confirmed = false) => {
    const shouldRequestRendererConfirmation =
      !Confirmed &&
      accidentalShutdownProtectionEnabled &&
      ModeManager.Get() === 'SHOW' &&
      hasMainWindow();

    if (shouldRequestRendererConfirmation) {
      MainWindow.webContents.send('ShutdownRequested');
      return;
    }

    Shutdown({ bypassAccidentalConfirmation: true });
  });

  RPC.handle('OpenLogsFolder', async (_event) => {
    let LogsPath = AppDataManager.GetLogsDirectory();
    Logger.log('Opening logs folder:', LogsPath);
    // Cross-platform and properly quoted
    await shell.openPath(LogsPath);
    return;
  });

  RPC.handle('OpenDiscordInviteLinkInBrowser', async (_event, _URL) => {
    const url = 'https://discord.gg/DACmwsbSGW';
    await shell.openExternal(url);
    return;
  });

  RPC.handle('OpenShowTrakWebsiteInBrowser', async (_event) => {
    const url = 'https://showtrak.co.uk';
    await shell.openExternal(url);
    return;
  });

  RPC.handle('OpenShowTrakGithubInBrowser', async (_event) => {
    const url = 'https://github.com/ShowTrak/ShowTrakFlow';
    await shell.openExternal(url);
    return;
  });

  RPC.handle('OpenNpmPackageInBrowser', async (_event, PackageName) => {
    const Name = String(PackageName || '').trim();
    if (!Name) return;
    const url = `https://www.npmjs.com/package/${encodeURIComponent(Name)}`;
    await shell.openExternal(url);
    return;
  });

  RPC.handle('GetProjectDependencies', async (_event) => {
    try {
      const CandidatePaths = [
        path.join(app.getAppPath(), 'package.json'),
        path.resolve(app.getAppPath(), '..', 'package.json'),
      ];

      let PackageJsonPath = null;
      for (const CandidatePath of CandidatePaths) {
        if (fs.existsSync(CandidatePath)) {
          PackageJsonPath = CandidatePath;
          break;
        }
      }

      if (!PackageJsonPath) {
        return ['Could not locate package.json', null];
      }

      const PackageJsonRaw = fs.readFileSync(PackageJsonPath, 'utf8');
      const PackageJson = JSON.parse(PackageJsonRaw);

      const DefaultRuntimeDependencies = new Set(['electron-squirrel-startup']);

      const Dependencies = Object.entries(PackageJson.dependencies || {})
        .filter(([name]) => !DefaultRuntimeDependencies.has(name))
        .map(([name, version]) => ({ name, version }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return [
        null,
        {
          dependencies: Dependencies,
        },
      ];
    } catch (error) {
      Logger.error('GetProjectDependencies failed', error);
      return [String(error), null];
    }
  });

  RPC.handle('SetSetting', async (_event, Key, Value) => {
    try {
      [Key, Value] = IPCValidation.SettingUpdatePayload(Key, Value);
    } catch (error) {
      return validationErrorTuple(error);
    }
    let [Err, Setting] = await SettingsManager.Set(Key, Value);
    if (Err) return [Err, null];
    return [null, Setting];
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // macOS: consider re-creating or showing a window when the dock icon is clicked.
    }
  });

  // MainWindow.webContents.openDevTools();
});

// Push the entire settings payload and group metadata to the renderer.
async function UpdateSettings() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  let Settings = await SettingsManager.GetAll();
  let SettingGroups = await SettingsManager.GetGroups();
  MainWindow.webContents.send('UpdateSettings', Settings, SettingGroups);
}

BroadcastManager.on('SettingsUpdated', UpdateSettings);

// Autosave: periodically snapshot the open ShowTrak file back to its path. The
// timer is rescheduled whenever the relevant settings change. A tick is a no-op
// when autosave is disabled or no file is currently open.
let AutosaveTimer = null;

async function RunAutosaveTick() {
  try {
    const Enabled = await SettingsManager.GetValue('SYSTEM_AUTOSAVE_ENABLED');
    if (!Enabled) return;
    const CurrentPath = BackupManager.GetCurrentFilePath();
    if (!CurrentPath) return;
    const [Err] = await BackupManager.Save(CurrentPath);
    if (Err) {
      Logger.error('Autosave failed:', Err);
      return;
    }
    Logger.log('Autosave completed to:', CurrentPath);
  } catch (Err) {
    Logger.error('Autosave tick error:', Err);
  }
}

async function ScheduleAutosave() {
  if (AutosaveTimer) {
    clearInterval(AutosaveTimer);
    AutosaveTimer = null;
  }
  const Enabled = await SettingsManager.GetValue('SYSTEM_AUTOSAVE_ENABLED');
  if (!Enabled) return;
  let Minutes = await SettingsManager.GetValue('SYSTEM_AUTOSAVE_INTERVAL_MINUTES');
  Minutes = Number(Minutes);
  if (!Number.isFinite(Minutes) || Minutes < 1) Minutes = 1;
  AutosaveTimer = setInterval(RunAutosaveTick, Minutes * 60 * 1000);
  Logger.log(`Autosave scheduled every ${Minutes} minute(s)`);
}

BroadcastManager.on('AutosaveSettingsChanged', ScheduleAutosave);
ScheduleAutosave().catch((Err) => Logger.error('Failed to schedule autosave:', Err));

// Full re-hydration: clear caches, re-fetch, and send authoritative lists.
async function ReinitializeSystem() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  Logger.log('Reinitializing system...');

  // Refresh manager caches that hold DB-backed state in memory.
  if (typeof SettingsManager.Reload === 'function') {
    await SettingsManager.Reload();
  }
  if (typeof AlertsManager.Reload === 'function') {
    await AlertsManager.Reload();
  }

  await UpdateSettings();
  await UpdateAlertRuleList();
}
BroadcastManager.on('ReinitializeSystem', ReinitializeSystem);

// OSC routes are read-only here; clone to avoid accidental mutation downstream.
async function UpdateOSCList() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  let Routes = OSC.GetRoutes();
  MainWindow.webContents.send('SetOSCList', JSON.parse(JSON.stringify(Routes)));
}

async function UpdateAlertRuleList() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  const [Err, Rules] = await AlertsManager.GetAll();
  if (Err) return Logger.error('Failed to fetch alert rules:', Err);
  MainWindow.webContents.send('SetFullAlertRuleList', Rules || []);
}
BroadcastManager.on('AlertRuleListChanged', UpdateAlertRuleList);

async function AlertTriggered(Payload) {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  MainWindow.webContents.send('AlertTriggered', Payload);
}
BroadcastManager.on('AlertTriggered', AlertTriggered);

// Raises an alert in the renderer alerts tray (driven by the ShowTrak Alert action).
async function CreateShowTrakAlert(Payload) {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  MainWindow.webContents.send('CreateShowTrakAlert', Payload);
}
BroadcastManager.on('CreateShowTrakAlert', CreateShowTrakAlert);

// ---- ShowTrak Flow list fan-out ----
async function UpdateFlowList() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  const [Err, Flows] = await FlowGroupsManager.GetAllFlows();
  if (Err) return;
  MainWindow.webContents.send('SetFlowList', Flows || []);
}
BroadcastManager.on('FlowListChanged', UpdateFlowList);

async function FlowGroupsChanged(FlowID) {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  MainWindow.webContents.send('FlowGroupsChanged', FlowID);
}
BroadcastManager.on('FlowGroupsChanged', FlowGroupsChanged);

async function UpdateQueue() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  const [Err, Queue] = await QueueManager.GetAll();
  if (Err) return;
  MainWindow.webContents.send('SetQueue', Queue || []);
}
BroadcastManager.on('QueueChanged', UpdateQueue);

async function UpdateSceneList() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  const [Err, Scenes] = await SceneManager.GetAll();
  if (Err) return;
  MainWindow.webContents.send('SetSceneList', Scenes || []);
}
BroadcastManager.on('SceneListChanged', UpdateSceneList);

function EnsureSceneTimerHeartbeat() {
  if (SceneTimerHeartbeat) return;
  SceneTimerHeartbeat = setInterval(async () => {
    if (!MainWindow || MainWindow.isDestroyed()) return;
    const [Err, Scenes] = await SceneManager.GetAll();
    if (Err || !Array.isArray(Scenes) || !Scenes.length) return;
    const hasRunningTimers = Scenes.some((Scene) => Scene && Scene.IsTimerRunning === true);
    if (!hasRunningTimers) return;
    MainWindow.webContents.send('SetSceneList', Scenes);
  }, 250);
}
EnsureSceneTimerHeartbeat();

async function UpdateFlagList() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  const [Err, Flags] = await FlagManager.GetAll();
  if (Err) return;
  MainWindow.webContents.send('SetFlagList', Flags || []);
}
BroadcastManager.on('FlagListChanged', UpdateFlagList);

async function UpdateRemoteUserList() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  const [Err, Users] = await RemoteUsersManager.GetAll();
  if (Err) return;
  MainWindow.webContents.send('SetRemoteUserList', Users || []);
}
BroadcastManager.on('RemoteUserListChanged', UpdateRemoteUserList);

async function UpdateShowColourList() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  const [Err, Colours] = await ShowColoursManager.GetAll();
  if (Err) return;
  MainWindow.webContents.send('SetShowColourList', Colours || []);
}
BroadcastManager.on('ShowColourListChanged', UpdateShowColourList);

async function UpdateChatRoomList() {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  const [Err, Rooms] = await ChatRoomsManager.GetAllRooms();
  if (Err) return;
  MainWindow.webContents.send('SetChatRoomList', Rooms || []);
}
BroadcastManager.on('ChatRoomListChanged', UpdateChatRoomList);
BroadcastManager.on('SceneListChanged', UpdateChatRoomList);

async function ForwardChatMessagesChanged(Payload) {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  MainWindow.webContents.send('ChatMessagesChanged', Payload || null);
}
BroadcastManager.on('ChatMessagesChanged', ForwardChatMessagesChanged);

// Thin wrapper to surface system notifications in the renderer.
async function Notify(Message, Type = 'info', Duration = 5000) {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  MainWindow.webContents.send('Notify', Message, Type, Duration);
}

BroadcastManager.on('Notify', Notify);

// UI-triggered audio feedback (short, non-blocking).
async function PlaySound(SoundName) {
  MainWindow.webContents.send('PlaySound', SoundName);
}
BroadcastManager.on('PlaySound', PlaySound);

// Batch an OSC-triggered action and let the renderer decide the UX.
async function HandleOSCBulkAction(Type, Targets, Args = null) {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  MainWindow.webContents.send('OSCBulkAction', Type, Targets, Args);
}

BroadcastManager.on('OSCBulkAction', HandleOSCBulkAction);

async function ForwardDebugTrafficEntry(Entry) {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  MainWindow.webContents.send('DebugTrafficEntry', Entry);
}

BroadcastManager.on('DebugTrafficEntry', ForwardDebugTrafficEntry);

BroadcastManager.on('Shutdown', async () => {
  Logger.log('Application shutdown requested (broadcast)');
  bypassShutdownConfirmation = true;
  quitRequested = true;
  app.quit();
});

BroadcastManager.on('ShutdownForce', async () => {
  Logger.warn('Application force shutdown requested (broadcast)');
  // Bypass close prompts so remote forced shutdowns can proceed immediately.
  bypassShutdownConfirmation = true;
  mainWindowCloseApproved = true;
  quitRequested = true;
  app.quit();
});

// Relay application mode changes to renderer windows
ModeManager.on('ModeUpdated', (Mode) => {
  if (!MainWindow || MainWindow.isDestroyed()) return;
  MainWindow.webContents.send('ModeUpdated', Mode);
});

app.on('window-all-closed', () => {
  app.quit();
});

async function runShutdownCleanup() {
  try {
    if (AutosaveTimer) {
      clearInterval(AutosaveTimer);
      AutosaveTimer = null;
    }
  } catch {}

  try {
    await DBManager.Shutdown({ TimeoutMs: 15000 });
  } catch (Err) {
    Logger.error('DB shutdown cleanup failed:', Err);
  }
}

app.on('before-quit', (event) => {
  quitRequested = true;

  if (quittingForUpdate) {
    return;
  }

  if (!mainWindowCloseApproved && hasMainWindow()) {
    event.preventDefault();
    MainWindow.close();
    return;
  }

  if (shutdownCleanupComplete) return;
  event.preventDefault();
  if (shutdownCleanupInFlight) return;

  shutdownCleanupInFlight = true;
  runShutdownCleanup()
    .catch((Err) => {
      Logger.error('Unexpected error during shutdown cleanup:', Err);
    })
    .finally(() => {
      shutdownCleanupComplete = true;
      shutdownCleanupInFlight = false;
      app.quit();
    });
});

// Feature toggles controlled by Settings: power-save blocker and auto-update.
async function StartOptionalFeatures() {
  let SYSTEM_PREVENT_DISPLAY_SLEEP = await SettingsManager.GetValue('SYSTEM_PREVENT_DISPLAY_SLEEP');
  if (SYSTEM_PREVENT_DISPLAY_SLEEP) {
    Logger.log('Prevent Display Sleep is enabled, starting powerSaveBlocker.');
    powerSaveBlocker.start('prevent-display-sleep');
  } else {
    Logger.log('Prevent Display Sleep is disabled in settings, not starting powerSaveBlocker.');
  }
}
StartOptionalFeatures();

powerMonitor.on('shutdown', (event) => {
  Logger.warn('System shutdown detected, routing through graceful app shutdown');
  event.preventDefault();
  bypassShutdownConfirmation = true;
  quitRequested = true;
  app.quit();
});

nativeAutoUpdater.on('before-quit-for-update', () => {
  Logger.log('Update install requested, bypassing shutdown guards');
  quittingForUpdate = true;
  bypassShutdownConfirmation = true;
  quitRequested = true;
});

// Final shutdown hook: place for flushing buffers/closing resources if needed.
app.on('will-quit', (_event) => {
  Logger.log('App is closing, performing cleanup...');
});
