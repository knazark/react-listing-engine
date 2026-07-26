import { describe, it, expect, vi } from 'vitest';
import { TypedEmitter } from '~/core/events/typed-emitter';
import type { ListingEvent } from '~/core/events/listing-events';
import { ListingEventType } from '~/enums';

type TestEvent = { type: 'a' | 'b'; value: number };

describe('TypedEmitter', () => {
  it('routes events to type-specific listeners', () => {
    const emitter = new TypedEmitter<TestEvent>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('a', a);
    emitter.on('b', b);

    emitter.emit({ type: 'a', value: 1 });
    emitter.emit({ type: 'b', value: 2 });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0]![0]).toEqual({ type: 'a', value: 1 });
  });

  it('routes every event to wildcard listeners', () => {
    const emitter = new TypedEmitter<TestEvent>();
    const all = vi.fn();
    emitter.on('*', all);
    emitter.emit({ type: 'a', value: 1 });
    emitter.emit({ type: 'b', value: 2 });
    expect(all).toHaveBeenCalledTimes(2);
  });

  it('on() returns an unsubscribe handle', () => {
    const emitter = new TypedEmitter<TestEvent>();
    const a = vi.fn();
    const unsubscribe = emitter.on('a', a);
    unsubscribe();
    emitter.emit({ type: 'a', value: 1 });
    expect(a).not.toHaveBeenCalled();
  });

  it('dispose() clears all listeners', () => {
    const emitter = new TypedEmitter<TestEvent>();
    const all = vi.fn();
    emitter.on('*', all);
    emitter.dispose();
    emitter.emit({ type: 'a', value: 1 });
    expect(all).not.toHaveBeenCalled();
  });

  it('round-trips a ListingEvent through a typed emitter', () => {
    const emitter = new TypedEmitter<ListingEvent>();
    const onResultsLoaded = vi.fn();
    emitter.on(ListingEventType.ResultsLoaded, onResultsLoaded);

    const event: ListingEvent = { type: ListingEventType.ResultsLoaded, datasetId: 'properties', count: 3 };
    emitter.emit(event);

    expect(onResultsLoaded).toHaveBeenCalledTimes(1);
    expect(onResultsLoaded).toHaveBeenCalledWith(event);
  });
});
