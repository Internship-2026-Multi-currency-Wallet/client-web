import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface ServerTimeState {
  status: 'idle' | 'live' | 'error';
  value: string | null;
  error: string | null;
}

const initialState: ServerTimeState = { status: 'idle', value: null, error: null };

const serverTimeSlice = createSlice({
  name: 'serverTime',
  initialState,
  reducers: {
    received(state, action: PayloadAction<string>) {
      state.status = 'live';
      state.value = action.payload;
      state.error = null;
    },
    failed(state, action: PayloadAction<string>) {
      state.status = 'error';
      state.error = action.payload;
    },
    reset: () => initialState,
  },
});

export const serverTimeActions = serverTimeSlice.actions;
export const serverTimeReducer = serverTimeSlice.reducer;
