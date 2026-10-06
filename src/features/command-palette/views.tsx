'use client';
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
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        Command Palette
      </h2>
      <label htmlFor={`${id}-input`}>Find a command or Incident</label>
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
                  (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length,
              });
          }
          if (event.key === 'Enter' && options[index]) {
            event.preventDefault();
            execute(options[index]);
          }
        }}
        maxLength={200}
        className="my-3 w-full rounded border border-line p-3"
      />
      <p role="status">
        {options.length} commands available{loading ? ' · Looking up Incidents…' : ''}
      </p>
      {error && <p role="alert">Incident lookup unavailable. Navigation commands still work.</p>}
      <ul id={`${id}-list`} role="listbox" aria-label="Commands" className="command-options">
        {options.map((command, optionIndex) => (
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
              className="w-full p-3 text-left"
            >
              <span className="block text-xs text-muted">{command.category}</span>
              {command.label}
              {optionIndex === index && <span className="sr-only"> · Selected</span>}
            </button>
          </li>
        ))}
      </ul>
      {!options.length && <p>No matching commands. Try a different word.</p>}
      <button onClick={close} className="mt-3 rounded border border-line p-3">
        Close palette
      </button>
    </dialog>
  );
}
