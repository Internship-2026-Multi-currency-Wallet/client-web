import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { subscribe } from '../../graphql/client';
import { serverTimeSubscription } from './server-time.rates-service';
import { serverTimeActions } from './serverTimeSlice';

/** Subscribes to `serverTime` (rates-service) while the component is mounted. */
export function useServerTime() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const unsubscribe = subscribe('ratesService', serverTimeSubscription, {
      next: (data) => dispatch(serverTimeActions.received(data.serverTime)),
      error: (error) => dispatch(serverTimeActions.failed(error.message)),
    });
    return () => {
      unsubscribe();
      dispatch(serverTimeActions.reset());
    };
  }, [dispatch]);
  return useAppSelector((state) => state.serverTime);
}
