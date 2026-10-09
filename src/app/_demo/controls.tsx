'use client';
import { useRef, useState } from 'react';
import { ConfirmationDialog } from '@/shared/ui/confirmation';
import { z } from 'zod';
import { demoConfigured, demoSchema, defaultDemo, type DemoConfig } from '@/features/demo/model';
import { useAppDispatch, useAppSelector } from '@/app/_providers/hooks';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { configureDemo, resetDemoConfig } from './runtime';
import { exclusiveDemoMaintenance, clearDemoStores } from './reset';
import { forgetFictionalClient, fictionalClientId } from '@/features/session/mock/browser';
import { Button } from '@/shared/ui/primitives';

export function DemoControls() {
  const config = useAppSelector((state) => state.demo);
  const dispatch = useAppDispatch();
  const { coordinator, adapter } = useSessionRuntime();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [maintenance, setMaintenance] = useState<'dataset' | 'reset' | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string>();
  const operationPending = useRef(false);
  const change = (patch: Partial<DemoConfig>) => {
    const next = demoSchema.parse({ ...config, ...patch });
    configureDemo(next);
    dispatch(demoConfigured(next));
    setFeedback('Demo configuration applied. Fault schedule restarted.');
  };
  const run = async (operation: () => Promise<void>) => {
    if (operationPending.current) return false;
    operationPending.current = true;
    setPending(true);
    setFeedback('Applying demo operation…');
    try {
      await operation();
      return true;
    } catch (error) {
      const message = `Demo operation unavailable. ${error instanceof Error ? error.message : 'Check browser storage/connection, reload and retry maintenance before trusting partial state.'}`;
      if (maintenance) {
        setMaintenanceError(message);
        setFeedback('');
      } else setFeedback(message);
      return false;
    } finally {
      operationPending.current = false;
      setPending(false);
    }
  };
  return (
    <div>
      {maintenance && (
        <ConfirmationDialog
          open
          title={maintenance === 'dataset' ? 'Replace showcase dataset?' : 'Reset Demo data?'}
          description={
            maintenance === 'dataset'
              ? 'Replace INC-2841 Timeline and clear its Threads, local work and activity journal. Other Incident data remains. Close other app tabs first.'
              : 'Remove all fictional accounts, incidents, messages, notifications, Postmortems, drafts and outbox on this origin. You will sign in again; the fictional baseline will be restored. Close other app tabs first.'
          }
          confirmLabel={maintenance === 'dataset' ? 'Replace dataset' : 'Reset Demo data'}
          destructive
          busy={pending}
          error={maintenanceError}
          cancel={() => {
            if (!operationPending.current) setMaintenance(null);
          }}
          confirm={() =>
            void run(async () => {
              setMaintenanceError(undefined);
              const demoRuntime = await import('@/app/_mocks/browser');
              if (maintenance === 'dataset') {
                await demoRuntime.replaceDemoDataset(config.datasetSize, () =>
                  coordinator.dispose(),
                );
                window.location.replace('/app/incidents/INC-2841');
              } else {
                await exclusiveDemoMaintenance(async () => {
                  await demoRuntime.quiesceDemo(() => coordinator.dispose());
                  await clearDemoStores();
                  forgetFictionalClient(fictionalClientId());
                });
                window.location.replace('/login');
              }
            })
          }
        />
      )}
      <p className="type-meta mb-5">
        Faults affect ordinary reads/mutations before persistence, not authentication or realtime
        polling. Never enter real data.
      </p>
      <fieldset disabled={pending} className="demo-controls">
        <legend className="sr-only">Fictional runtime configuration</legend>
        <section className="demo-group" aria-labelledby="demo-requests">
          <h3 id="demo-requests" className="type-section">
            Requests
          </h3>
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
        </section>
        <section className="demo-group" aria-labelledby="demo-connection">
          <h3 id="demo-connection" className="type-section">
            Connection / activity
          </h3>
          <Button
            onClick={() =>
              change({
                realtimeConnection:
                  config.realtimeConnection === 'connected' ? 'disconnected' : 'connected',
              })
            }
          >
            {config.realtimeConnection === 'connected'
              ? 'Disconnect realtime'
              : 'Reconnect realtime'}
          </Button>
          <p className="type-meta">
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
          <Button
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
          </Button>
        </section>
        <section className="demo-group" aria-labelledby="demo-dataset">
          <h3 id="demo-dataset" className="type-section">
            Dataset
          </h3>
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
          <Button
            onClick={() => {
              setMaintenanceError(undefined);
              setMaintenance('dataset');
            }}
          >
            Replace showcase dataset
          </Button>
          <p className="demo-maintenance-note">
            10k/50k are stress scenarios. Replacement is destructive for this room. Close other app
            tabs first. DOM remains virtualized; authority storage cost grows with data.
          </p>
        </section>
        <section className="demo-group" aria-labelledby="demo-maintenance">
          <h3 id="demo-maintenance" className="type-section">
            Maintenance
          </h3>
          <Button
            onClick={() => {
              resetDemoConfig();
              dispatch(demoConfigured(defaultDemo));
              setFeedback('Faults cleared; persistent data unchanged.');
            }}
          >
            Clear simulations
          </Button>
          <p className="demo-maintenance-note">
            Clear simulations keeps persistent data. Reset removes all fictional data on this origin
            and signs you out.
          </p>
          <Button
            variant="danger"
            onClick={() => {
              setMaintenanceError(undefined);
              setMaintenance('reset');
            }}
          >
            Reset Demo data
          </Button>
        </section>
      </fieldset>
      <p role="status" className="demo-feedback mt-4">
        {feedback}
      </p>
    </div>
  );
}
