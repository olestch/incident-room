'use client';
import { useState } from 'react';
import { z } from 'zod';
import { demoConfigured, demoSchema, defaultDemo, type DemoConfig } from '@/features/demo/model';
import { useAppDispatch, useAppSelector } from '@/app/_providers/hooks';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { AppError } from '@/shared/errors/app-error';
import { configureDemo, resetDemoConfig } from './runtime';
import { exclusiveDemoMaintenance, clearDemoStores } from './reset';
import { forgetFictionalClient, fictionalClientId } from '@/features/session/mock/browser';

export function DemoControls() {
  const config = useAppSelector((state) => state.demo);
  const dispatch = useAppDispatch();
  const { coordinator, adapter } = useSessionRuntime();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const change = (patch: Partial<DemoConfig>) => {
    const next = demoSchema.parse({ ...config, ...patch });
    configureDemo(next);
    dispatch(demoConfigured(next));
    setFeedback('Demo configuration applied. Fault schedule restarted.');
  };
  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    setFeedback('Applying demo operation…');
    try {
      await operation();
    } catch (error) {
      setFeedback(
        `Demo operation unavailable. ${error instanceof AppError ? error.message : 'Check browser storage/connection, reload and retry maintenance before trusting partial state.'}`,
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <details className="mt-4 rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Demo Mode · fictional controls
      </summary>
      <p className="mt-3 text-sm text-muted">
        Tab-local configuration; reload returns to defaults. Faults affect ordinary reads/mutations
        before persistence, not authentication or realtime polling. Never enter real data.
      </p>
      <fieldset disabled={pending} className="mt-4 grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">Fictional runtime configuration</legend>
        <label>
          Request latency
          <select
            className="incident-input"
            value={config.latency}
            onChange={(e) => change({ latency: Number(e.target.value) as DemoConfig['latency'] })}
          >
            {[0, 500, 2000, 5000].map((n) => (
              <option key={n} value={n}>
                {n} ms
              </option>
            ))}
          </select>
        </label>
        <label>
          Failure rate
          <select
            className="incident-input"
            value={config.failureRate}
            onChange={(e) =>
              change({ failureRate: Number(e.target.value) as DemoConfig['failureRate'] })
            }
          >
            {[0, 10, 30].map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
          </select>
        </label>
        <button
          className="incident-button"
          onClick={() =>
            change({
              realtimeConnection:
                config.realtimeConnection === 'connected' ? 'disconnected' : 'connected',
            })
          }
        >
          {config.realtimeConnection === 'connected' ? 'Disconnect realtime' : 'Reconnect realtime'}
        </button>
        <p>
          Simulation: {config.latency} ms · {config.failureRate}% failures · realtime{' '}
          {config.realtimeConnection}
        </p>
        <label>
          Generate activity
          <select
            className="incident-input"
            value={config.eventGeneration}
            onChange={(e) =>
              change({ eventGeneration: demoSchema.shape.eventGeneration.parse(e.target.value) })
            }
          >
            {['monitoring', 'deployment', 'human', 'status'].map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </label>
        <button
          className="incident-button"
          onClick={() =>
            void run(async () => {
              const number =
                window.location.pathname.match(/\/incidents\/(INC-\d+)/)?.[1] ?? 'INC-2841';
              await coordinator.request(
                (signal) =>
                  adapter.resource('/demo/event', z.object({ ok: z.literal(true) }), signal, {
                    kind: config.eventGeneration,
                    number,
                  }),
                'mutation',
              );
              setFeedback(
                `Generated ${config.eventGeneration} activity in ${number}. Open the room to observe authoritative delivery.`,
              );
            })
          }
        >
          Generate persistent event
        </button>
        <label>
          Timeline stress size
          <select
            className="incident-input"
            value={config.datasetSize}
            onChange={(e) =>
              change({ datasetSize: Number(e.target.value) as DemoConfig['datasetSize'] })
            }
          >
            {[100, 1000, 10000, 50000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString('en-US')}
              </option>
            ))}
          </select>
        </label>
        <button
          className="incident-button"
          onClick={() => {
            if (
              !window.confirm(
                'Replace INC-2841 Timeline and clear its Threads, local work and activity journal? Close other app tabs. Other Incident data remains.',
              )
            )
              return;
            void run(async () => {
              const demoRuntime = await import('@/app/_mocks/browser');
              await demoRuntime.replaceDemoDataset(config.datasetSize, () => coordinator.dispose());
              window.location.replace('/app/incidents/INC-2841');
            });
          }}
        >
          Replace showcase dataset
        </button>
        <p className="text-sm text-muted sm:col-span-2">
          10k/50k are stress scenarios. Replacement is destructive for this room. Close other app
          tabs first. DOM remains virtualized; authority storage cost grows with data.
        </p>
        <button
          className="incident-button"
          onClick={() => {
            resetDemoConfig();
            dispatch(demoConfigured(defaultDemo));
            setFeedback('Faults cleared; persistent data unchanged.');
          }}
        >
          Clear simulations
        </button>
        <button
          className="incident-button"
          onClick={() => {
            if (
              !window.confirm(
                'Reset ALL fictional accounts, incidents, messages, notifications, Postmortems, drafts and outbox on this origin? Close other app tabs. You will sign in again.',
              )
            )
              return;
            void run(async () => {
              const demoRuntime = await import('@/app/_mocks/browser');
              await exclusiveDemoMaintenance(async () => {
                await demoRuntime.quiesceDemo(() => coordinator.dispose());
                await clearDemoStores();
                forgetFictionalClient(fictionalClientId());
              });
              window.location.replace('/login');
            });
          }}
        >
          Reset Demo data
        </button>
      </fieldset>
      <p role="status" className="mt-3 text-sm">
        {feedback}
      </p>
    </details>
  );
}
