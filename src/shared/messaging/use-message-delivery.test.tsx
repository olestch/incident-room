import { StrictMode, useCallback, useEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MessageDelivery } from './delivery';
import { LocalWorkService, emptyLocalData } from './local-work';
import type { DeliveredMessage } from './model';
import { useMessageDelivery } from './use-message-delivery';

it('Strict Mode recreates disposed delivery runtimes, restores the draft and quarantines disposed continuations', async () => {
  const changed = vi.fn();
  const work = new LocalWorkService({
    transact: async (_key, operation) =>
      operation({ ...emptyLocalData(), drafts: { room: 'Retained draft' } }),
  });
  const lease = work.lease({ userId: 'river', workspaceId: 'orbit', incidentId: 'room' });
  const runtimes: MessageDelivery<DeliveredMessage>[] = [];
  function Editor() {
    const create = useCallback(() => {
      const runtime = new MessageDelivery<DeliveredMessage>(work, lease, {
        changed,
        confirmed: vi.fn(),
        create: vi.fn(),
        lookup: vi.fn(),
      });
      runtimes.push(runtime);
      return runtime;
    }, []);
    const delivery = useMessageDelivery(create);
    const [draft, setDraft] = useState('Restoring');
    useEffect(() => {
      let active = true;
      void delivery
        .restore()
        .then((body) => {
          if (active) setDraft(body);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [delivery]);
    return <p>{draft}</p>;
  }
  const view = render(
    <StrictMode>
      <Editor />
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByText('Retained draft')).toBeVisible());
  expect(runtimes).toHaveLength(2);
  expect(changed).toHaveBeenCalledTimes(1);
  await expect(runtimes[0]!.restore()).rejects.toThrow('Room superseded');
  view.unmount();
  await expect(runtimes[1]!.restore()).rejects.toThrow('Room superseded');
});
