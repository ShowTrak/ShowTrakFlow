// Pure rule-matching and human-readable description helpers used to decide
// whether an alert rule fires for a given runtime context.

function isScopeMatch(Rule, Context) {
  const Scope = Rule.Scope || {};
  const Workspace = !!Scope.Workspace;
  const GroupIDs = new Set(Array.isArray(Scope.Groups) ? Scope.Groups.map((x) => Number(x)) : []);
  const Clients = new Set(Array.isArray(Scope.Clients) ? Scope.Clients.map((x) => String(x)) : []);

  if (Workspace) return true;
  if (Context.GroupID != null && GroupIDs.has(Number(Context.GroupID))) return true;

  if (Context.UUID && Clients.has(String(Context.UUID))) return true;
  if (Context.EntityType === 'monitor' && Context.TargetID != null) {
    if (Clients.has(`monitor:${Context.TargetID}`)) return true;
  }
  return false;
}

function triggerMatches(Rule, Context) {
  if (!Rule || !Context || !Rule.TriggerType) return false;
  return Context.TriggerType === Rule.TriggerType;
}

function describeContext(Context) {
  if (Context && typeof Context.Description === 'string' && Context.Description.trim()) {
    return Context.Description.trim();
  }
  if (Context && Context.EntityName) {
    return `${Context.EntityName} triggered ${Context.TriggerType || 'an alert'}`;
  }
  return 'Alert triggered';
}

module.exports = {
  isScopeMatch,
  triggerMatches,
  describeContext,
};
