import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { z } from 'zod';
import { memberSchema, type PresenceMember } from './protocol';
import { RealtimeSummary, TimelineTyping } from './views';

function broker() {
  let now = 0;
  let receive!: (event: { data: unknown; ports: { postMessage(value: unknown): void }[] }) => void;
  // Exercise the actual standalone fictional-server worker, not a copied test broker.
  runInNewContext(readFileSync(resolve('public/fictional-realtime-worker.js'), 'utf8'), {
    Date: { now: () => now },
    addEventListener(name: string, callback: typeof receive) {
      if (name === 'message') receive = callback;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  });
  const request = (
    action: string,
    clientId: string,
    userId: string,
    room = 'orbit:room',
    typing = false,
  ) => {
    let output: unknown;
    receive({
      data: { action, clientId, userId, room, typing },
      ports: [
        {
          postMessage: (value) => {
            output = value;
          },
        },
      ],
    });
    return output === undefined ? null : z.array(memberSchema).parse(output);
  };
  return {
    request,
    advance(ms: number) {
      now += ms;
    },
  };
}
it('ephemeral joins/leaves are room scoped and retain independent same-user client leases', () => {
  const server = broker();
  server.request('join', 'a', 'river');
  server.request('join', 'b', 'river');
  expect(server.request('pulse', 'a', 'river')).toHaveLength(2);
  expect(server.request('join', 'c', 'sage', 'another:room')).toHaveLength(1);
  expect(server.request('leave', 'b', 'river')).toHaveLength(1);
});
it('abandoned presence expires; worker restart loses ephemeral state and heartbeats rebuild it', () => {
  const server = broker();
  server.request('join', 'a', 'river');
  server.request('join', 'b', 'sage');
  server.advance(4001);
  expect(server.request('pulse', 'a', 'river')).toMatchObject([{ clientId: 'a' }]);
  const restarted = broker();
  expect(restarted.request('pulse', 'b', 'sage')).toMatchObject([{ clientId: 'b' }]);
});
it('typing expiry/stop changes no persistent event and malformed broker input is isolated', () => {
  const server = broker();
  server.request('join', 'a', 'river', 'orbit:room', true);
  server.advance(3001);
  const peers = server.request('join', 'b', 'sage')!;
  expect(peers.find((peer) => peer.clientId === 'a')!.typingUntil).toBeLessThan(3001);
  expect(
    server.request('pulse', 'a', 'river')!.find((peer) => peer.clientId === 'a')!.typingUntil,
  ).toBe(0);
  expect(server.request('unsupported', 'x', 'unknown')).toBeNull();
});
it('presence summary discovers names, typing excludes own identity and larger groups are concise', () => {
  const members: PresenceMember[] = ['river', 'sage', 'lumen', 'cedar'].map((userId, index) => ({
    userId,
    clientId: String(index),
    expiresAt: 4000,
    typingUntil: 3000,
  }));
  const users = members.map((member) => ({
    id: member.userId,
    workspaceId: 'orbit',
    name: member.userId,
    email: `${member.userId}@example.test`,
    role: 'member' as const,
    status: 'active' as const,
    avatar: null,
  }));
  render(
    <>
      <RealtimeSummary
        status="connected"
        members={members}
        users={users}
        userId="river"
        retry={() => {}}
      />
      <TimelineTyping members={members} users={users} userId="river" />
    </>,
  );
  expect(screen.getByLabelText('Realtime connection')).toHaveTextContent('Connected');
  expect(screen.getByLabelText('Incident presence')).toHaveTextContent('4 people viewing');
  expect(screen.getByLabelText('Timeline typing')).toHaveTextContent('3 people are typing…');
  expect(screen.getByLabelText('Incident presence')).toHaveTextContent('cedar');
});
