import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

const slice = createSlice({
  name: 'localWork',
  initialState: { scopes: {} as Record<string, { ids: string[]; states: string[] }> },
  reducers: {
    localWorkChanged(
      state,
      action: PayloadAction<{ scope: string; ids: string[]; states: string[] }>,
    ) {
      state.scopes[action.payload.scope] = {
        ids: action.payload.ids,
        states: action.payload.states,
      };
    },
    localWorkCleared(state) {
      state.scopes = {};
    },
  },
});
export const { localWorkChanged, localWorkCleared } = slice.actions;
export const localWorkReducer = slice.reducer;
