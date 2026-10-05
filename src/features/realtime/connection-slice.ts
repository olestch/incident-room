import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

interface ConnectionState {
  status: ConnectionStatus;
}

// Room services publish serializable lifecycle facts; runtime instances stay outside Redux.
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
