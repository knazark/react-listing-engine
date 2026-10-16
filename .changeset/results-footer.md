---
'react-listing-engine': patch
---

Add a `resultsFooter` slot to the styled layout and `ListingApp`: content rendered inside the results column after the pagination (an internal-links tail, related searches), so it scrolls with the list and sits beside the map. It is omitted when `resultsSlot` replaces the column.
