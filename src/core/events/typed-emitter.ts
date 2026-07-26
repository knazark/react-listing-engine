type Listener<E> = (event: E) => void;

/**
 * Tiny typed event emitter. Subscribers can listen to a specific event type
 * (matched on `event.type`) or via the `'*'` wildcard. Returns an unsubscribe
 * handle from `on()`.
 */
export class TypedEmitter<E extends { type: string }> {
  private readonly map = new Map<'*' | string, Set<Listener<E>>>();

  public dispose(): void {
    this.map.clear();
  }

  public emit(event: E): void {
    const specific = this.map.get(event.type);
    if (specific) {
      for (const handler of [...specific]) handler(event);
    }
    const wildcard = this.map.get('*');
    if (wildcard) {
      for (const handler of [...wildcard]) handler(event);
    }
  }

  public on(type: '*' | E['type'], handler: Listener<E>): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }
}
