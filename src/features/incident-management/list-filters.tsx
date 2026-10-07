'use client';
import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { emptyFilters, type IncidentFilters } from '@/entities/incident/filters';
import { severities, severityLabels, statuses, statusLabels } from '@/entities/incident/model';
import { Button, IconButton } from '@/shared/ui/primitives';
import { LifecycleBadge, SeverityBadge } from './badges';

function FilterPopover({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="filter-popover">
      <Button
        ref={trigger}
        popoverTarget={id}
        aria-expanded={open}
        aria-label={`${label} filter${count ? `, ${count} selected` : ''}`}
        className={count ? 'filter-selected' : ''}
      >
        {label}
        {count > 0 && <span className="filter-count">{count}</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </Button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="filter-panel"
        aria-label={`${label} options`}
        onToggle={(event) => {
          const isOpen = event.newState === 'open';
          setOpen(isOpen);
          if (!isOpen || !trigger.current) return;
          const rect = trigger.current.getBoundingClientRect();
          const element = event.currentTarget;
          element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - element.offsetWidth - 8))}px`;
          element.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - element.offsetHeight - 8))}px`;
          element.querySelector<HTMLElement>('input, select')?.focus();
        }}
      >
        <div className="filter-panel-heading">
          <h3>{label}</h3>
          <IconButton
            label={`Close ${label} filter`}
            onClick={() => {
              panel.current?.hidePopover();
              trigger.current?.focus();
            }}
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export function IncidentFiltersView({
  filters,
  users,
  change,
}: {
  filters: IncidentFilters;
  users: WorkspaceUser[];
  change: (value: IncidentFilters) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...filters.status.map((value) => ({
      key: `status-${value}`,
      label: `Status: ${statusLabels[value]}`,
      remove: () => change({ ...filters, status: filters.status.filter((item) => item !== value) }),
    })),
    ...filters.severity.map((value) => ({
      key: `severity-${value}`,
      label: `Severity: ${value}`,
      remove: () =>
        change({ ...filters, severity: filters.severity.filter((item) => item !== value) }),
    })),
    ...(filters.participant
      ? [
          {
            key: 'participant',
            label: `Participant: ${users.find((user) => user.id === filters.participant)?.name ?? 'Unavailable workspace user'}`,
            remove: () => change({ ...filters, participant: '' }),
          },
        ]
      : []),
    ...(filters.from
      ? [
          {
            key: 'from',
            label: `Created from: ${filters.from} UTC`,
            remove: () => change({ ...filters, from: '' }),
          },
        ]
      : []),
    ...(filters.to
      ? [
          {
            key: 'to',
            label: `Created through: ${filters.to} UTC`,
            remove: () => change({ ...filters, to: '' }),
          },
        ]
      : []),
    ...(filters.assignedToMe
      ? [
          {
            key: 'assigned',
            label: 'Assigned to me',
            remove: () => change({ ...filters, assignedToMe: false }),
          },
        ]
      : []),
  ];
  return (
    <section aria-label="Incident filters" className="discovery-filters">
      <div className="filter-toolbar">
        <Button
          className="filter-mobile-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(!expanded)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          Filters{chips.length > 0 && <span className="filter-count">{chips.length}</span>}
        </Button>
        <div className="filter-dimensions" id={panelId} data-expanded={expanded}>
          <FilterPopover label="Status" count={filters.status.length}>
            <fieldset>
              <legend className="sr-only">Status</legend>
              {statuses.map((value) => (
                <label className="filter-option" key={value}>
                  <input
                    type="checkbox"
                    aria-label={statusLabels[value]}
                    checked={filters.status.includes(value)}
                    onChange={(event) =>
                      change({
                        ...filters,
                        status: event.target.checked
                          ? [...filters.status, value]
                          : filters.status.filter((item) => item !== value),
                      })
                    }
                  />
                  <span aria-hidden="true">
                    <LifecycleBadge status={value} />
                  </span>
                </label>
              ))}
            </fieldset>
          </FilterPopover>
          <FilterPopover label="Severity" count={filters.severity.length}>
            <fieldset>
              <legend className="sr-only">Severity</legend>
              {severities.map((value) => (
                <label className="filter-option" key={value}>
                  <input
                    type="checkbox"
                    aria-label={`${value} · ${severityLabels[value]}`}
                    checked={filters.severity.includes(value)}
                    onChange={(event) =>
                      change({
                        ...filters,
                        severity: event.target.checked
                          ? [...filters.severity, value]
                          : filters.severity.filter((item) => item !== value),
                      })
                    }
                  />
                  <span aria-hidden="true">
                    <SeverityBadge severity={value} />
                  </span>
                </label>
              ))}
            </fieldset>
          </FilterPopover>
          <FilterPopover label="Participant" count={filters.participant ? 1 : 0}>
            <label className="discovery-field">
              Participant
              <select
                aria-label="Participant"
                value={filters.participant}
                onChange={(event) => change({ ...filters, participant: event.target.value })}
              >
                <option value="">Any participant</option>
                {users
                  .filter((user) => user.status === 'active')
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
              </select>
            </label>
          </FilterPopover>
          <FilterPopover label="Created date" count={Number(!!filters.from) + Number(!!filters.to)}>
            <label className="discovery-field">
              Created from (UTC)
              <input
                type="date"
                value={filters.from}
                onChange={(event) => change({ ...filters, from: event.target.value })}
              />
            </label>
            <label className="discovery-field">
              Created through (UTC)
              <input
                type="date"
                value={filters.to}
                onChange={(event) => change({ ...filters, to: event.target.value })}
              />
            </label>
            <p className="filter-help">Includes both dates, in UTC.</p>
          </FilterPopover>
        </div>
        <label className="filter-assigned">
          <input
            type="checkbox"
            checked={filters.assignedToMe}
            onChange={(event) => change({ ...filters, assignedToMe: event.target.checked })}
          />
          Assigned to me
        </label>
        <label className="filter-sort">
          <span>Sort</span>
          <select
            aria-label="Sort"
            value={filters.sort}
            onChange={(event) =>
              change({ ...filters, sort: event.target.value as IncidentFilters['sort'] })
            }
          >
            <option value="updated">Last updated</option>
            <option value="newest">Newest created</option>
            <option value="severity">Severity</option>
          </select>
        </label>
      </div>
      {chips.length > 0 && (
        <div className="filter-chips" aria-label="Active filters">
          {chips.map((chip) => (
            <Button
              key={chip.key}
              variant="quiet"
              className="filter-chip"
              aria-label={`Remove ${chip.label}`}
              onClick={chip.remove}
            >
              {chip.label}
              <X size={13} aria-hidden="true" />
            </Button>
          ))}
          <Button
            variant="quiet"
            className="filter-clear"
            onClick={() => change({ ...emptyFilters, sort: filters.sort })}
          >
            Clear filters
          </Button>
        </div>
      )}
    </section>
  );
}
