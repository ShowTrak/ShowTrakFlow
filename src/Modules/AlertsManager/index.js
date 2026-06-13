const { CreateLogger } = require('../Logger');
const Logger = CreateLogger('AlertsManager');

const { Manager: DB } = require('../DB');
const { Manager: AlertActions } = require('../AlertActions');
const { Manager: BroadcastManager } = require('../Broadcast');
const { Ok, Fail } = require('../Utils');

const {
  normalizeRuleRow,
  toRowScope,
  toRowActions,
  toRowTriggerConfig,
} = require('./serialization');
const { isScopeMatch, triggerMatches, describeContext } = require('./evaluation');

const Manager = {};

let Initialized = false;
let RuleList = [];
let AlertActionsEnabled = true;

async function writeHistory(Rule, Context, Results) {
  const ResultPayload = {
    Actions: Results,
  };
  const Run =
    typeof DB.RunWithoutDirtyTracking === 'function'
      ? DB.RunWithoutDirtyTracking.bind(DB)
      : DB.Run.bind(DB);
  const [Err] = await Run(
    'INSERT INTO AlertHistory (RuleID, TriggerType, TriggerSource, Context, Result, Timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    [
      Rule.RuleID,
      Rule.TriggerType,
      Context.EntityType,
      JSON.stringify(Context),
      JSON.stringify(ResultPayload),
      Date.now(),
    ]
  );
  if (Err) Logger.error('Failed to persist alert history', Err);
}

async function executeRule(Rule, Context) {
  if (!AlertActionsEnabled) return;

  const Actions = Array.isArray(Rule.Actions) ? Rule.Actions : [];
  if (!Actions.length) return;

  const Description = describeContext(Context);
  const EventContext = {
    ...Context,
    Description,
  };

  const Settled = await Promise.allSettled(
    Actions.map((Action) =>
      AlertActions.Execute(Action, {
        ...EventContext,
      })
    )
  );

  const Results = Settled.map((Result, Index) => {
    const ActionType = Actions[Index] && Actions[Index].Type ? Actions[Index].Type : 'unknown';
    if (Result.status === 'fulfilled') {
      return {
        Type: ActionType,
        Success: !!(Result.value && Result.value.Success),
        Error: Result.value && Result.value.Error ? Result.value.Error : null,
      };
    }
    return {
      Type: ActionType,
      Success: false,
      Error: Result.reason && Result.reason.message ? Result.reason.message : String(Result.reason),
    };
  });

  await writeHistory(Rule, Context, Results);

  BroadcastManager.emit('AlertTriggered', {
    RuleID: Rule.RuleID,
    RuleTitle: Rule.Title,
    TriggerType: Rule.TriggerType,
    Context: EventContext,
    Results,
    Timestamp: Date.now(),
  });
}

async function evaluateAgainstRules(Context) {
  for (const Rule of RuleList) {
    if (!Rule.Enabled) continue;
    if (!isScopeMatch(Rule, Context)) continue;
    if (!triggerMatches(Rule, Context)) continue;
    await executeRule(Rule, Context);
  }
}

Manager.Init = async () => {
  if (Initialized) return;
  const [Err, Rows] = await DB.All('SELECT * FROM AlertRules ORDER BY RuleID DESC', []);
  if (Err) {
    Logger.error('Failed to load alert rules', Err);
    RuleList = [];
    Initialized = true;
    return;
  }
  RuleList = (Rows || []).map(normalizeRuleRow);
  Initialized = true;
};

Manager.GetAll = async () => {
  if (!Initialized) await Manager.Init();
  return Ok(RuleList);
};

Manager.Get = async (RuleID) => {
  if (!Initialized) await Manager.Init();
  const Rule = RuleList.find((R) => R.RuleID === Number(RuleID));
  if (!Rule) return Fail('Alert rule not found');
  return Ok(Rule);
};

Manager.GetTriggers = () => {
  // ShowTrak Flow ships with no built-in alert triggers yet.
  return [];
};

Manager.GetActionTypes = () => {
  return AlertActions.GetAll();
};

Manager.Create = async (Payload) => {
  if (!Initialized) await Manager.Init();

  const Timestamp = Date.now();
  const Row = {
    Title: Payload.Title,
    Scope: toRowScope(Payload.Scope || {}),
    TriggerType: Payload.TriggerType,
    TriggerConfig: toRowTriggerConfig(Payload.TriggerConfig || {}),
    Actions: toRowActions(Payload.Actions || []),
    Enabled: Payload.Enabled ? 1 : 0,
    Timestamp,
    UpdatedAt: Timestamp,
  };

  const [Err, Res] = await DB.Run(
    'INSERT INTO AlertRules (Title, Scope, TriggerType, TriggerConfig, Actions, Enabled, Timestamp, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      Row.Title,
      Row.Scope,
      Row.TriggerType,
      Row.TriggerConfig,
      Row.Actions,
      Row.Enabled,
      Row.Timestamp,
      Row.UpdatedAt,
    ]
  );
  if (Err || !Res) return Fail('Failed to create alert rule');

  const Created = normalizeRuleRow({
    RuleID: Res.lastID,
    ...Row,
  });

  RuleList.unshift(Created);
  BroadcastManager.emit('AlertRuleListChanged');
  return Ok(Created);
};

Manager.Update = async (RuleID, Payload) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(RuleID);
  const Existing = RuleList.find((R) => R.RuleID === ID);
  if (!Existing) return Fail('Alert rule not found');

  const Next = {
    Title: Object.prototype.hasOwnProperty.call(Payload, 'Title') ? Payload.Title : Existing.Title,
    Scope: Object.prototype.hasOwnProperty.call(Payload, 'Scope') ? Payload.Scope : Existing.Scope,
    TriggerType: Object.prototype.hasOwnProperty.call(Payload, 'TriggerType')
      ? Payload.TriggerType
      : Existing.TriggerType,
    TriggerConfig: Object.prototype.hasOwnProperty.call(Payload, 'TriggerConfig')
      ? Payload.TriggerConfig
      : Existing.TriggerConfig,
    Actions: Object.prototype.hasOwnProperty.call(Payload, 'Actions')
      ? Payload.Actions
      : Existing.Actions,
    Enabled: Object.prototype.hasOwnProperty.call(Payload, 'Enabled')
      ? !!Payload.Enabled
      : Existing.Enabled,
  };

  const UpdatedAt = Date.now();

  const [Err] = await DB.Run(
    'UPDATE AlertRules SET Title = ?, Scope = ?, TriggerType = ?, TriggerConfig = ?, Actions = ?, Enabled = ?, UpdatedAt = ? WHERE RuleID = ?',
    [
      Next.Title,
      toRowScope(Next.Scope),
      Next.TriggerType,
      toRowTriggerConfig(Next.TriggerConfig),
      toRowActions(Next.Actions),
      Next.Enabled ? 1 : 0,
      UpdatedAt,
      ID,
    ]
  );

  if (Err) return Fail('Failed to update alert rule');

  const Updated = {
    ...Existing,
    ...Next,
    UpdatedAt,
  };

  RuleList = RuleList.map((Rule) => (Rule.RuleID === ID ? Updated : Rule));
  BroadcastManager.emit('AlertRuleListChanged');
  return Ok(Updated);
};

Manager.Delete = async (RuleID) => {
  if (!Initialized) await Manager.Init();
  const ID = Number(RuleID);
  const [Err] = await DB.Run('DELETE FROM AlertRules WHERE RuleID = ?', [ID]);
  if (Err) return Fail('Failed to delete alert rule');
  RuleList = RuleList.filter((Rule) => Rule.RuleID !== ID);
  BroadcastManager.emit('AlertRuleListChanged');
  return Ok(true);
};

Manager.SetEnabled = async (RuleID, Enabled) => {
  return Manager.Update(RuleID, { Enabled: !!Enabled });
};

Manager.GetActionsEnabled = () => {
  return AlertActionsEnabled;
};

Manager.SetActionsEnabled = (Enabled) => {
  AlertActionsEnabled = !!Enabled;
  return AlertActionsEnabled;
};

// Generic evaluation hook for future ShowTrak Flow triggers: feed a runtime
// Context whose TriggerType matches a rule's TriggerType to evaluate it against
// all enabled alert rules and fire their actions.
Manager.Evaluate = async (Context) => {
  if (!Initialized) await Manager.Init();
  await evaluateAgainstRules(Context || {});
};

// Rebuild in-memory rules after external bulk writes (e.g., config import).
Manager.Reload = async () => {
  Initialized = false;
  RuleList = [];
  await Manager.Init();
  BroadcastManager.emit('AlertRuleListChanged');
};

module.exports = {
  Manager,
};
