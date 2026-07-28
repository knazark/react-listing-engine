export * from './interfaces';
export * from './enums';
export * from './core';
export * from './react';

// The `/styled`, Tailwind-free `ListingApp` is the package's MAIN-ENTRY
// default -- `import { ListingApp } from 'react-listing-engine'` gives you a
// self-contained, batteries-included app (pair it with `import
// 'react-listing-engine/styles.css'`). Only this ONE component (plus its
// props type) is re-exported here, not the rest of `./styled` (its
// `Styled*` slot components, `styledDefaultComponents`, etc. stay reachable
// via the dedicated `react-listing-engine/styled` subpath, NOT re-exported
// from here) -- this keeps the main entry's surface small
// and intentional rather than re-exporting an entire adapter wholesale.
export { ListingApp } from './styled/listing-app';
export type { ListingAppProps } from './styled/listing-app';
// `MobileSheetFooterContext` is the type `ListingAppProps.mobileSheetFooter`
// hands back to a consumer's render prop -- exported here (unlike the rest of
// `./styled`) so a consumer typing that callback doesn't need the
// `react-listing-engine/styled` subpath just for this one type, same
// reasoning as `FilterRegistry` (used by `ListingAppProps.filters`) already
// being reachable via `export * from './core'` above.
export type { MobileSheetFooterContext } from './styled/listing-layout';
