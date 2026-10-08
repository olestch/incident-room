import { expect, it, vi } from 'vitest';
import Page from './page';
const redirect = vi.hoisted(() =>
  vi.fn((destination: string) => {
    throw new Error(destination);
  }),
);
vi.mock('next/navigation', () => ({ redirect }));

it('redirects to a fixed list destination, forces assignment, drops cursor and retains encoded query values', async () => {
  await expect(
    Page({
      searchParams: Promise.resolve({
        severity: ['P1', 'P2'],
        status: 'monitoring',
        participant: 'demo-sage',
        from: '2026-09-01',
        to: '2026-10-02',
        sort: 'severity',
        assignedToMe: ['false', 'false'],
        assigned: 'other',
        cursor: 'old',
        tracking: ['keep & safe', '/app/my-incidents'],
        next: 'https://example.test',
      }),
    }),
  ).rejects.toThrow('/app/incidents?');
  const destination = new URL(redirect.mock.calls.at(-1)![0], 'http://localhost');
  expect(destination.pathname).toBe('/app/incidents');
  expect(destination.searchParams.getAll('severity')).toEqual(['P1', 'P2']);
  expect(destination.searchParams.getAll('assignedToMe')).toEqual(['true']);
  expect(destination.searchParams.has('assigned')).toBe(false);
  expect(destination.searchParams.has('cursor')).toBe(false);
  expect(destination.searchParams.getAll('tracking')).toEqual(['keep & safe', '/app/my-incidents']);
  expect(destination.searchParams.get('next')).toBe('https://example.test');
});
