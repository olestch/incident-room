'use client';
import Link from 'next/link';
import { FileWarning, MessageSquare, MessagesSquare, UserRound, ArrowUpRight } from 'lucide-react';
import { Avatar, Badge } from '@/shared/ui/primitives';
import { highlightSegments, searchDestination, type SearchResult } from '@/entities/search/model';
const vocabulary = {
  incident: { label: 'Incident', icon: FileWarning },
  timeline_message: { label: 'Timeline message', icon: MessageSquare },
  thread_message: { label: 'Thread message', icon: MessagesSquare },
  user: { label: 'Person', icon: UserRound },
};
function ResultTime({ value }: { value: string }) {
  return (
    <time dateTime={value}>{new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</time>
  );
}
export function SearchResults({ items, query }: { items: readonly SearchResult[]; query: string }) {
  return (
    <ul aria-label="Search results" className="discovery-results">
      {items.map((item) => {
        const { icon: Icon, label } = vocabulary[item.type];
        return (
          <li key={`${item.type}:${item.id}`} className="discovery-result">
            <span className="discovery-row-icon">
              {item.type === 'user' ? (
                <Avatar name={item.name} />
              ) : (
                <Icon size={20} aria-hidden="true" />
              )}
            </span>
            <div className="discovery-row-body">
              <div className="secondary-meta">
                <span>{label}</span>
                {'incidentNumber' in item && <span>{item.incidentNumber}</span>}
              </div>
              <Link className="discovery-result-link" href={searchDestination(item)}>
                {item.type === 'user' ? item.name : item.title}
                <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <p className="discovery-snippet">
                {highlightSegments(item.snippet, query).map((segment, index) =>
                  segment.match ? (
                    <mark key={index}>{segment.text}</mark>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
              </p>
              {(item.type === 'timeline_message' || item.type === 'thread_message') && (
                <p className="secondary-meta">
                  Author: {item.authorName ?? item.authorId} · <ResultTime value={item.time} />
                </p>
              )}
              {item.type === 'incident' && (
                <div className="secondary-meta">
                  <Badge>{item.severity}</Badge>
                  <span>{item.status.replaceAll('_', ' ')}</span>
                  <span>{item.serviceIds.join(', ') || 'No affected services'}</span>
                  <span>
                    Updated <ResultTime value={item.time} />
                  </span>
                </div>
              )}
              {item.type === 'user' && (
                <div className="secondary-meta">
                  <span>{item.role === 'admin' ? 'Admin' : 'Member'}</span>
                  <Badge>
                    {item.status === 'active' ? 'Active account' : 'Deactivated account'}
                  </Badge>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
