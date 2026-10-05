import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

interface ConnectionState {
  status: ConnectionStatus;
}

// No transport starts in Phase 1. Services will publish serializable lifecycle facts here.
const initialState: ConnectionState = { status: 'offline' };

const connectionSlice = createSlice({
  name: 'connection',
  initialState,
  reducers: {
    connectionChanged(state, action: PayloadAction<ConnectionStatus>) {
      state.status = action.payload;
    },
  },
});

export const { connectionChanged } = connectionSlice.actions;
export const connectionReducer = connectionSlice.reducer;
