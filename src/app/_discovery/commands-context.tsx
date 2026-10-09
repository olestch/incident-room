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
  registerLeave: (callback: () => boolean | Promise<boolean>) => () => void;
  canLeave: () => Promise<boolean>;
  readNotice: string | null;
  announceReadFailure: (detail?: string) => void;
  dismissReadNotice: () => void;
} | null>(null);
export function CommandsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [readNotice, setReadNotice] = useState<string | null>(null);
  const announceReadFailure = useCallback(
    (detail = 'Read state could not be saved.') => setReadNotice(detail),
    [],
  );
  const dismissReadNotice = useCallback(() => setReadNotice(null), []);
  const port = useRef<(() => void) | null>(null);
  const leave = useRef<(() => boolean | Promise<boolean>) | null>(null);
  const registerLeave = useCallback((callback: () => boolean | Promise<boolean>) => {
    leave.current = callback;
    return () => {
      if (leave.current === callback) leave.current = null;
    };
  }, []);
  const canLeave = useCallback(async () => leave.current?.() ?? true, []);
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
  const create = useCallback(async () => {
    if (!(await canLeave())) return;
    if (port.current) port.current();
    else {
      pending.current = true;
      router.push('/app/incidents');
    }
  }, [router, canLeave]);
  const value = useMemo(
    () => ({
      registerCreate,
      create,
      registerPalette,
      openPalette,
      registerThread,
      closeThread,
      registerLeave,
      canLeave,
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
      registerLeave,
      canLeave,
      readNotice,
      announceReadFailure,
      dismissReadNotice,
    ],
  );
  return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>;
}
export const useCommands = () => useContext(CommandsContext);
