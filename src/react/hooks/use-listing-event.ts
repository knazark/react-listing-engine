'use client';

import { useEffect, useRef } from 'react';

import type { ListingEvent } from '~/core';
import type { ListingEventType } from '~/enums';

import { useListing } from './use-listing';

/**
 * Subscribes to `engine.on(type, ...)` for the lifetime of the component.
 * `handler` is stashed in a ref and refreshed on every render (a plain
 * during-render assignment, not inside the effect), so the subscription
 * always invokes the LATEST closure — but the `useEffect` dependency array is
 * `[engine, type]` only, so a changing `handler` identity (e.g. a new inline
 * closure every render) never tears down and re-subscribes the listener.
 */
export function useListingEvent(type: ListingEventType | '*', handler: (e: ListingEvent) => void): void {
  const engine = useListing();

  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    // `handler` is intentionally NOT a dependency — it's read via
    // handlerRef.current (always fresh), so a changing closure identity
    // never tears down and re-subscribes this listener.
    return engine.on(type, event => handlerRef.current(event));
  }, [engine, type]);
}
