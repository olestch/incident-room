'use client';
import Link from 'next/link';
import { highlightSegments, searchDestination, type SearchResult } from '@/entities/search/model';
export function SearchResults({ items, query }: { items: readonly SearchResult[]; query: string }) {
  return (
    <ul className="space-y-4" aria-label="Search results">
      {items.map((result) => (
        <li key={`${result.type}:${result.id}`} className="rounded-lg border border-line p-4">
          <p className="text-sm text-muted">
            {result.type.replaceAll('_', ' ')}
            {'incidentNumber' in result ? ` · ${result.incidentNumber}` : ''}
          </p>
          <Link className="font-semibold underline" href={searchDestination(result)}>
            {'title' in result ? result.title : result.name}
          </Link>
          <p className="break-words">
            {highlightSegments(result.snippet, query).map((segment, index) =>
              segment.match ? (
                <mark key={index}>{segment.text}</mark>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </p>
          {'authorId' in result && (
            <p className="text-sm text-muted">
              Author: {result.authorName ?? result.authorId} ·{' '}
              <time dateTime={result.time}>
                {new Date(result.time).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
              </time>
            </p>
          )}
          {result.type === 'incident' && (
            <p>
              {result.severity} · {result.status} ·{' '}
              {result.serviceIds.join(', ') || 'No affected services'}
              {' · Updated '}
              <time dateTime={result.time}>
                {new Date(result.time).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
              </time>
            </p>
          )}
          {result.type === 'user' && (
            <p>
              <span
                aria-hidden="true"
                className="mr-2 inline-flex size-9 items-center justify-center rounded-full border border-line"
              >
                {result.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')}
              </span>
              {result.role} · {result.status}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
