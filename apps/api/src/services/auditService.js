const events = [];

export function recordAudit(entry) {
  const event = {
    id: `aud-${Date.now()}-${events.length}`,
    timestamp: new Date().toISOString(),
    user: entry.user || "eoc.operator",
    incident: entry.incident || null,
    action: entry.action,
    dataSources: entry.dataSources || [],
    detail: entry.detail || null,
  };
  events.unshift(event);
  if (events.length > 400) events.pop();
  return event;
}

export function listAudit(limit = 80) {
  return events.slice(0, limit);
}
