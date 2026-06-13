var Config = {};

let Selected = [];

// Empty stubs retained so the (workspace-only) alert-rule scope picker and a
// few inert selection helpers keep working without the removed client systems.
let AllClients = [];
let MonitoringTargets = [];
let DummyClients = [];
const GroupUUIDCache = new Map();

let AlertRuleEditorRuleID = null;
let AlertEditingActionIndex = null;
let AlertRuleDraftActions = [];
let AlertRulesCache = [];
let AlertActionTypesCache = [];
let AlertTriggerTypesCache = [];
let AlertScopeGroups = [];
let AlertScopeOptions = [];
let AlertScopeSelected = [];
let AlertActionEditorIsCreating = false;
const ALERT_TRIGGER_ALLOWLIST = new Set();

let SettingsGroups = [];
let Settings = [];
let SettingDebounceTimers = new Map();

// --- Application Mode (SHOW | EDIT) ---
let AppMode = 'SHOW'; // default visual state until backend confirms
const COMPACT_MODE_STORAGE_KEY = 'showtrak.ui.compactMode';
let CompactMode = false;
let AlertActionsEnabled = true;
