import { describe, expect, it } from 'vitest';
import { DEFAULT_DESTINATION, safeReturnDestination } from './return-destination';
describe('safe return destination', () => {
  it.each([
    '/app/incidents',
    '/app/incidents/INC-2841?event=evt-10#context',
    '/app/search?q=database%20lag',
  ])('preserves %s', (value) => {
    expect(safeReturnDestination(value)).toBe(value);
  });
  it.each([
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    'javascript:alert(1)',
    'data:text/html,test',
    '/login',
    '/application/test',
    '/app/../login',
    '/app/%2e%2e/login',
    '/app/%252e%252e/login',
    '/app//evil',
    '/app/\\evil',
    '/app/%5cevil',
    '/app/%2fevil',
    '/app/test%00',
    '/app/test%GG',
  ])('rejects %s', (value) => {
    expect(safeReturnDestination(value)).toBe(DEFAULT_DESTINATION);
  });
});
