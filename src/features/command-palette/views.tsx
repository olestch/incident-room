'use client';
import { Fragment } from 'react';
import {
  Search,
  ArrowRight,
  FileWarning,
  Command as CommandIcon,
  X,
  CornerDownLeft,
} from 'lucide-react';
import { IconButton } from '@/shared/ui/primitives';
import { useEffect, useRef, useState, useId } from 'react';
import { filterCommands, type Command } from './model';
import { createDiagnostics } from '@/shared/diagnostics/diagnostics';
export function CommandPalette({
  commands,
  remote,
  input,
  change,
  close,
  execute,
  loading,
  error,
}: {
  commands: readonly Command[];
  remote: readonly Command[];
  input: string;
  change: (value: string) => void;
  close: () => void;
  execute: (command: Command) => void;
  loading: boolean;
  error: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  const [selection, setSelection] = useState({ query: '', index: 0 });
  const options = [...filterCommands(commands, input), ...remote];
  const index = Math.min(
    selection.query === input ? selection.index : 0,
    Math.max(0, options.length - 1),
  );
  useEffect(() => {
    createDiagnostics().record({ event: 'command_palette_opened' });
    const opener = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    field.current?.focus();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    document.getElementById(`${id}-option-${index}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [id, index, options.length]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="command-dialog"
    >
      <div className="command-heading">
        <h2 id={`${id}-title`} className="command-title">
          Command Palette
        </h2>
        <IconButton label="Close palette" onClick={close}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="command-query">
        <Search size={20} aria-hidden="true" />
        <label className="sr-only" htmlFor={`${id}-input`}>
          Find a command or Incident
        </label>
        <input
          ref={field}
          id={`${id}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={options[index] ? `${id}-option-${index}` : undefined}
          value={input}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (options.length)
                setSelection({
                  query: input,
                  index:
                    (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                    options.length,
                });
            }
            if (event.key === 'Enter' && options[index]) {
              event.preventDefault();
              execute(options[index]);
            }
          }}
          maxLength={200}
          className="command-input"
          placeholder="Find a command or Incident"
        />
      </div>
      <p role="status" className="command-status">
        {options.length} commands available{loading ? ' · Looking up Incidents…' : ''}
      </p>
      {error && (
        <p role="alert" className="command-error">
          Incident lookup unavailable. Navigation commands still work.
        </p>
      )}
      <ul id={`${id}-list`} role="listbox" aria-label="Commands" className="command-options">
        {options.map((command, optionIndex) => {
          const group =
            command.category === 'Incidents'
              ? 'Incidents'
              : command.id === 'search-query'
                ? 'Search all content'
                : 'Commands';
          const previous = options[optionIndex - 1];
          const previousGroup =
            previous?.category === 'Incidents'
              ? 'Incidents'
              : previous?.id === 'search-query'
                ? 'Search all content'
                : previous
                  ? 'Commands'
                  : null;
          const Icon =
            command.category === 'Incidents'
              ? FileWarning
              : command.id === 'search-query'
                ? Search
                : CommandIcon;
          return (
            <Fragment key={command.id}>
              {group !== previousGroup && (
                <li role="presentation" className="command-group">
                  {group}
                </li>
              )}

              <li
                key={command.id}
                role="option"
                aria-selected={optionIndex === index}
                id={`${id}-option-${optionIndex}`}
                className={optionIndex === index ? 'command-selected' : ''}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => execute(command)}
                  className="command-option-button"
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    <span className="sr-only">{command.category} · </span>
                    {command.label}
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                  {optionIndex === index && <span className="sr-only"> · Selected</span>}
                </button>
              </li>
            </Fragment>
          );
        })}
      </ul>
      {!options.length && (
        <p className="command-empty">No matching commands. Try a different word.</p>
      )}
      <footer className="command-footer" aria-hidden="true">
        <span>
          <kbd>Up</kbd>
          <kbd>Down</kbd> Navigate
        </span>
        <span>
          <CornerDownLeft size={14} /> Open
        </span>
        <span>
          <kbd>Esc</kbd> Close
        </span>
      </footer>
    </dialog>
  );
}
