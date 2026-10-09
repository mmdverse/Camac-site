import { useSyncExternalStore } from 'react';
import { store } from './store';

/** Subscribe a React component to a slice of the store. Re-renders only when the selector result changes. */
export function useStore(selector = (s) => s) {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store),
    () => selector(store),
  );
}
