'use client';
import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
const CommandsContext = createContext<{
  registerCreate: (callback: () => void) => () => void;
  create: () => void;
  registerPalette: (callback: () => void) => () => void;
  openPalette: () => void;
  registerThread: (callback: () => void) => () => void;
  closeThread: () => void;
  readNotice: boolean;
  announceReadFailure: () => void;
  dismissReadNotice: () => void;
} | null>(null);
export function CommandsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [readNotice, setReadNotice] = useState(false);
  const announceReadFailure = useCallback(() => setReadNotice(true), []);
  const dismissReadNotice = useCallback(() => setReadNotice(false), []);
  const port = useRef<(() => void) | null>(null);
  const pending = useRef(false);
  const palette = useRef<(() => void) | null>(null),
    thread = useRef<(() => void) | null>(null);
  const registerPalette = useCallback((callback: () => void) => {
    palette.current = callback;
    return () => {
      if (palette.current === callback) palette.current = null;
    };
  }, []);
  const openPalette = useCallback(() => palette.current?.(), []);
  const registerThread = useCallback((callback: () => void) => {
    thread.current = callback;
    return () => {
      if (thread.current === callback) thread.current = null;
    };
  }, []);
  const closeThread = useCallback(() => thread.current?.(), []);
  const registerCreate = useCallback((callback: () => void) => {
    port.current = callback;
    if (pending.current) {
      pending.current = false;
      callback();
    }
    return () => {
      if (port.current === callback) port.current = null;
    };
  }, []);
  const create = useCallback(() => {
    if (port.current) port.current();
    else {
      pending.current = true;
      router.push('/app/incidents');
    }
  }, [router]);
  const value = useMemo(
    () => ({
      registerCreate,
      create,
      registerPalette,
      openPalette,
      registerThread,
      closeThread,
      readNotice,
      announceReadFailure,
      dismissReadNotice,
    }),
    [
      registerCreate,
      create,
      registerPalette,
      openPalette,
      registerThread,
      closeThread,
      readNotice,
      announceReadFailure,
      dismissReadNotice,
    ],
  );
  return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>;
}
export const useCommands = () => useContext(CommandsContext);
