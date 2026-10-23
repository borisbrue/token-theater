import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { PlaybackController } from './controller';
import type { PlaybackState } from './types';

/**
 * Brücke vom Controller zu React (SPEC-0002 FR-08): spiegelt den Zustand in einen Zustand-Store.
 * Erzeugt weder Controller noch Scheduler – die App setzt sie zusammen (§3.7).
 */
export interface PlaybackStore {
  controller: PlaybackController;
  store: StoreApi<PlaybackState>;
  usePlayback<T>(selector: (state: PlaybackState) => T): T;
  dispose(): void;
}

export function createPlaybackStore(controller: PlaybackController): PlaybackStore {
  const store = createStore<PlaybackState>(() => controller.getState());
  const unsubscribe = controller.subscribe((state) => store.setState(state, true));
  return {
    controller,
    store,
    usePlayback: (selector) => useStore(store, selector),
    dispose: unsubscribe,
  };
}
