import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

// Exercise the actual primitive in a native browser, including failures after mutation.
const source = transpileModule(readFileSync('src/shared/persistence/atomic-store.ts', 'utf8'), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS },
}).outputText;

test('native atomic transactions roll back a mutated callback failure and serialize independent stores', async ({
  page,
}) => {
  await page.goto('/login');
  const result = await page.evaluate(async (source) => {
    type Value = { count: number };
    type Store = { transact<R>(key: string, operation: (value: Value) => R): Promise<R> };
    const exports: { IndexedDbAtomicStore?: new (...args: unknown[]) => Store } = {};
    new Function('exports', source)(exports);
    const Constructor = exports.IndexedDbAtomicStore!;
    const name = 'incident-room-transaction-regression-' + crypto.randomUUID();
    const create = () =>
      new Constructor(
        name,
        () => ({ count: 0 }),
        (raw: Value) => raw,
        'incidents',
      );
    const first = create();
    const second = create();
    await first.transact('singleton', (value) => {
      value.count = 7;
    });
    let error = '';
    try {
      await first.transact('singleton', (value) => {
        value.count = 999;
        throw new Error('Intentional operation failure');
      });
    } catch (failure) {
      error = (failure as Error).message;
    }
    const afterFailure = await second.transact('singleton', (value) => value.count);
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 ? first : second).transact('singleton', (value) => {
          value.count += 1;
        }),
      ),
    );
    const final = await create().transact('singleton', (value) => value.count);
    return { error, afterFailure, final };
  }, source);
  expect(result).toEqual({ error: 'Intentional operation failure', afterFailure: 7, final: 17 });
});
