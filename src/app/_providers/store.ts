import { configureStore } from '@reduxjs/toolkit';
import { connectionReducer } from '@/features/realtime/connection-slice';

export function makeStore() {
  return configureStore({
    reducer: { connection: connectionReducer },
    devTools: process.env.NODE_ENV !== 'production',
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
