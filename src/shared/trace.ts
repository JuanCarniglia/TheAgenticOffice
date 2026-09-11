/** Shared stdout / browser console logger for the office sim. */

export function officeLog(scope: string, ...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[office ${ts}] [${scope}]`, ...args);
}

export function summarizeEvent(event: { type: string } & Record<string, unknown>): string {
  switch (event.type) {
    case "say":
    case "whisper":
    case "meeting_say":
      return `${event.type} ${event.agentId}: ${event.text}`;
    case "customer_line":
      return `chat ${event.from} → ${event.to}: ${event.text}`;
    case "status":
      return `status ${event.agentId}: ${event.status}`;
    case "move_to":
      return `move ${event.agentId} → ${event.zone}`;
    case "dm":
      return `dm ${event.from} → ${event.to}: ${event.text}`;
    case "watercooler":
      return `cooler ${event.from}: ${event.text}`;
    case "clock":
      return `clock ${event.time}${event.label ? ` (${event.label})` : ""}`;
    case "tick":
      return `tick #${event.n} ${event.time}`;
    case "sale":
      return `sale ${event.salesperson} ${event.qty} ${event.unit} ${event.label} +$${event.revenue}`;
    case "books":
      return `books $${event.balance} today $${event.todayEarnings} tokens ${event.todayTokens}`;
    case "stock":
      return `stock ${Array.isArray(event.items) ? event.items.length : "?"} skus`;
    case "reorder_alert":
      return `reorder ${event.label} at ${event.qty}/${event.reorderAt}`;
    case "reordered":
      return `reordered ${event.qty} ${event.unit} ${event.label} -$${event.cost}`;
    case "bell":
      return "bell (Pam)";
    case "phone":
      return `phone ${event.kind}`;
    case "fire":
      return event.on ? `fire ON ${event.zone}` : "fire out";
    case "error":
      return `ERROR ${event.message}`;
    case "guardrail":
      return `guardrail ${event.channel} ${event.reason}: ${event.reply}`;
    case "session_started":
      return `session_started ${event.clock} $${event.balance}`;
    case "goal_met":
      return "goal_met";
    case "office_locked":
      return "office_locked";
    case "tasks_replaced":
      return `tasks_replaced ${(event.tasks as unknown[])?.length ?? 0}`;
    case "queue_update":
      return `queue ${event.agentId}`;
    case "meeting_start":
      return `meeting_start ${event.title}`;
    case "meeting_end":
      return `meeting_end ${event.title}`;
    case "task_update":
      return `task ${JSON.stringify(event.task)}`;
    case "trace":
      return `trace ${event.agentId} ${event.tool}: ${event.summary}${
        typeof event.tokens === "number" ? ` (${event.tokens} tok)` : ""
      }`;
    default:
      return event.type;
  }
}
