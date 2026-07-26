/**
 * Shown whenever `VITE_GOOGLE_MAPS_KEY` is unset -- the listing still
 * composes and renders without a `MapProvider` (`ListingMap` mounts nothing
 * and simply renders an empty container; see `withMap` in `compose-listing-providers.ts`),
 * this is purely a UX hint so the empty map band doesn't look broken.
 */
export function MapKeyNotice() {
  return (
    <div className="border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
      Set <code className="rounded bg-background px-1 py-0.5 font-mono">VITE_GOOGLE_MAPS_KEY</code> in a{' '}
      <code className="rounded bg-background px-1 py-0.5 font-mono">.env</code> file (see{' '}
      <code className="rounded bg-background px-1 py-0.5 font-mono">.env.example</code>) to enable the live map.
    </div>
  );
}
