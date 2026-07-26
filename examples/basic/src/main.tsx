import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app';
import './index.css';
// `/styled`'s plain, Tailwind-free stylesheet -- required by the two
// "Properties" scenarios, which now render the package's MAIN-ENTRY
// `ListingApp` (the self-contained `/styled` adapter). `index.css` (Tailwind)
// stays imported too: the app shell (`app.tsx`'s header/tabs) and the
// "Custom components"/"Custom filters" scenarios still use `/shadcn`'s
// Tailwind-based `ListingLayout`, and the rental preset's `PropertyCard`/
// `PropertyMarker` (used as `components` overrides in the Properties
// scenarios) are themselves Tailwind components -- both stylesheets coexist
// with zero class-name collisions (`.rle-*` vs Tailwind utilities/tokens).
import 'react-listing-engine/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
