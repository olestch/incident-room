import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { SessionState } from './session-model';

const initialState: SessionState = { status: 'restoring', generation: 0 };
const slice = createSlice({
  name: 'session',
  initialState: initialState as SessionState,
  reducers: { sessionChanged: (_state, action: PayloadAction<SessionState>) => action.payload },
});
export const { sessionChanged } = slice.actions;
export const sessionReducer = slice.reducer;
