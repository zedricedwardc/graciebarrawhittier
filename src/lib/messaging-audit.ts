/**
 * Detection logic for the four failure modes behind the Jul 2026 booking collapse:
 * duplicate sends, unanswered replies, and (via opp-rescue.ts) stalled stage timers.
 *
 * Pure — no network I/O — so it is unit-testable. scripts/audit-messaging-health.ts
 * supplies the GHL data. This is the compensating control for stage timers being
 * hand-configured in the GHL UI rather than driven from STAGE_TRANSITIONS.
 */

const HOUR_MS = 3_600_000;
/** Bodies are compared on a prefix — merge tags make full-body equality useless. */
const BODY_PREFIX_LEN = 60;

export interface AuditMessage {
  id: string;
  contactId: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  body: string;
  status?: string;
  dateAdded: string;
}

export interface DuplicateSend {
  contactId: string;
  messageType: string;
  bodyPrefix: string;
  hoursApart: number;
}

export interface UnansweredReply {
  contactId: string;
  repliedAt: string;
  body: string;
  hoursWaiting: number;
}

const normalise = (body: string): string =>
  body.replace(/\s+/g, ' ').trim().slice(0, BODY_PREFIX_LEN);

/** Same channel + same body prefix + same contact, sent twice within windowHours. */
export function detectDuplicateSends(messages: AuditMessage[], windowHours: number): DuplicateSend[] {
  const out: DuplicateSend[] = [];
  const lastSeen = new Map<string, number>();

  const ordered = messages
    .filter((m) => m.direction === 'outbound')
    .slice()
    .sort((a, b) => Date.parse(a.dateAdded) - Date.parse(b.dateAdded));

  for (const m of ordered) {
    const prefix = normalise(m.body);
    const key = `${m.contactId}|${m.messageType}|${prefix}`;
    const prev = lastSeen.get(key);
    const at = Date.parse(m.dateAdded);
    if (prev !== undefined) {
      const hoursApart = Math.round((at - prev) / HOUR_MS);
      if (hoursApart <= windowHours) {
        out.push({ contactId: m.contactId, messageType: m.messageType, bodyPrefix: prefix, hoursApart });
      }
    }
    lastSeen.set(key, at);
  }
  return out;
}

/**
 * For each contact, flags every unanswered inbound message turn.
 * Consecutive inbounds within slaHours form a single turn — only the last
 * message of each burst is reported. Messages still inside their SLA window
 * are not yet late and are skipped.
 */
export function findUnansweredReplies(
  messages: AuditMessage[],
  slaHours: number,
  now: number,
): UnansweredReply[] {
  const byContact = new Map<string, AuditMessage[]>();
  for (const m of messages) {
    const list = byContact.get(m.contactId);
    if (list) list.push(m);
    else byContact.set(m.contactId, [m]);
  }

  const out: UnansweredReply[] = [];
  for (const [contactId, list] of byContact) {
    const ordered = list.slice().sort((a, b) => Date.parse(a.dateAdded) - Date.parse(b.dateAdded));
    const inbounds = ordered.filter((m) => m.direction === 'inbound');

    for (let i = 0; i < inbounds.length; i++) {
      const inbound = inbounds[i]!;
      const inboundAt = Date.parse(inbound.dateAdded);

      // Skip if there's a later inbound within slaHours (part of same burst)
      let skipBurst = false;
      for (let j = i + 1; j < inbounds.length; j++) {
        const nextInbound = inbounds[j]!;
        const nextInboundAt = Date.parse(nextInbound.dateAdded);
        const hoursToNext = (nextInboundAt - inboundAt) / HOUR_MS;
        if (hoursToNext <= slaHours) {
          skipBurst = true;
          break;
        }
      }
      if (skipBurst) continue;

      // Skip if still inside SLA window
      const hoursWaiting = Math.round((now - inboundAt) / HOUR_MS);
      if (hoursWaiting < slaHours) continue;

      // Skip if there's an outbound response within SLA
      const answered = ordered.some(
        (m) =>
          m.direction === 'outbound' &&
          Date.parse(m.dateAdded) > inboundAt &&
          Date.parse(m.dateAdded) - inboundAt <= slaHours * HOUR_MS,
      );
      if (answered) continue;

      out.push({ contactId, repliedAt: inbound.dateAdded, body: inbound.body, hoursWaiting });
    }
  }
  return out.sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}
