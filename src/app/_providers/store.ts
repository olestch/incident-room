import { configureStore } from '@reduxjs/toolkit';
import { connectionReducer } from '@/features/realtime/connection-slice';
import { sessionReducer } from '@/features/session/session-slice';
import { localWorkReducer } from '@/features/timeline/coordination-slice';
import { demoReducer } from '@/features/demo/model';

export function makeStore() {
  return configureStore({
    reducer: {
      connection: connectionReducer,
      session: sessionReducer,
      localWork: localWorkReducer,
      demo: demoReducer,
    },
    devTools: process.env.NODE_ENV !== 'production',
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
