import { describe, it, expect } from 'vitest';
import { detectDuplicateSends, findUnansweredReplies, type AuditMessage } from './messaging-audit';

const NOW = Date.parse('2026-07-30T00:00:00Z');
const hoursAgo = (n: number) => new Date(NOW - n * 3600000).toISOString();

function msg(over: Partial<AuditMessage>): AuditMessage {
  return {
    id: 'm1', contactId: 'c1', direction: 'outbound', messageType: 'TYPE_SMS',
    body: 'Book your first class', status: 'delivered', dateAdded: hoursAgo(1), ...over,
  };
}

describe('detectDuplicateSends', () => {
  it('flags the same body sent twice to one contact inside the window', () => {
    const dupes = detectDuplicateSends([
      msg({ id: 'a', dateAdded: hoursAgo(48) }),
      msg({ id: 'b', dateAdded: hoursAgo(24) }),
    ], 72);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!).toMatchObject({ contactId: 'c1', hoursApart: 24 });
  });

  it('does not flag the same body sent outside the window', () => {
    expect(detectDuplicateSends([
      msg({ id: 'a', dateAdded: hoursAgo(200) }),
      msg({ id: 'b', dateAdded: hoursAgo(24) }),
    ], 72)).toEqual([]);
  });

  it('does not flag the same body sent to different contacts', () => {
    expect(detectDuplicateSends([
      msg({ id: 'a', contactId: 'c1' }),
      msg({ id: 'b', contactId: 'c2' }),
    ], 72)).toEqual([]);
  });

  it('does not flag inbound messages', () => {
    expect(detectDuplicateSends([
      msg({ id: 'a', direction: 'inbound' }),
      msg({ id: 'b', direction: 'inbound' }),
    ], 72)).toEqual([]);
  });

  it('treats SMS and email with identical text as distinct channels', () => {
    expect(detectDuplicateSends([
      msg({ id: 'a', messageType: 'TYPE_SMS' }),
      msg({ id: 'b', messageType: 'TYPE_EMAIL' }),
    ], 72)).toEqual([]);
  });
});

describe('findUnansweredReplies', () => {
  it('flags an inbound reply with no outbound response inside the SLA', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', body: 'Can we do 4pm?', dateAdded: hoursAgo(48) }),
    ], 24, NOW);
    expect(un).toHaveLength(1);
    expect(un[0]!).toMatchObject({ contactId: 'c1', body: 'Can we do 4pm?', hoursWaiting: 48 });
  });

  it('does not flag a reply that got an outbound response inside the SLA', () => {
    expect(findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', dateAdded: hoursAgo(48) }),
      msg({ id: 'b', direction: 'outbound', dateAdded: hoursAgo(40) }),
    ], 24, NOW)).toEqual([]);
  });

  it('flags when the only outbound response arrives after the SLA', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', dateAdded: hoursAgo(96) }),
      msg({ id: 'b', direction: 'outbound', dateAdded: hoursAgo(40) }),
    ], 24, NOW);
    expect(un).toHaveLength(1);
  });

  it('does not flag a reply still inside its SLA window', () => {
    expect(findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', dateAdded: hoursAgo(3) }),
    ], 24, NOW)).toEqual([]);
  });

  it('judges each contact independently', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', contactId: 'c1', direction: 'inbound', dateAdded: hoursAgo(48) }),
      msg({ id: 'b', contactId: 'c2', direction: 'inbound', dateAdded: hoursAgo(48) }),
      msg({ id: 'c', contactId: 'c2', direction: 'outbound', dateAdded: hoursAgo(47) }),
    ], 24, NOW);
    expect(un.map((u) => u.contactId)).toEqual(['c1']);
  });

  it('flags an earlier ignored reply even when a later reply was answered in time', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', body: 'Can we do 4pm?', dateAdded: hoursAgo(200) }),
      msg({ id: 'b', direction: 'inbound', body: 'Still there?', dateAdded: hoursAgo(100) }),
      msg({ id: 'c', direction: 'outbound', dateAdded: hoursAgo(99) }),
    ], 24, NOW);
    expect(un).toHaveLength(1);
    expect(un[0]!).toMatchObject({ body: 'Can we do 4pm?', hoursWaiting: 200 });
  });

  it('collapses a burst of inbound messages into a single finding', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', body: 'hello', dateAdded: hoursAgo(52) }),
      msg({ id: 'b', direction: 'inbound', body: 'you there?', dateAdded: hoursAgo(50) }),
      msg({ id: 'c', direction: 'inbound', body: 'anyone?', dateAdded: hoursAgo(48) }),
    ], 24, NOW);
    expect(un).toHaveLength(1);
    expect(un[0]!).toMatchObject({ body: 'anyone?', hoursWaiting: 48 });
  });

  it('reports two separate unanswered turns for the same contact', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', body: 'first', dateAdded: hoursAgo(300) }),
      msg({ id: 'b', direction: 'inbound', body: 'second', dateAdded: hoursAgo(100) }),
    ], 24, NOW);
    expect(un).toHaveLength(2);
    expect(un.map((u) => u.body)).toEqual(['first', 'second']);
  });

  it('does not flag an earlier inbound that was answered in time', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', body: 'first', dateAdded: hoursAgo(200) }),
      msg({ id: 'b', direction: 'outbound', dateAdded: hoursAgo(199) }),
      msg({ id: 'c', direction: 'inbound', body: 'second', dateAdded: hoursAgo(100) }),
    ], 24, NOW);
    expect(un).toHaveLength(1);
    expect(un[0]!.body).toBe('second');
  });
});
