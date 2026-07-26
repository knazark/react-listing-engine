import { useState, type ReactNode } from 'react';

import { CustomComponentsScenario } from './scenarios/custom-components';
import { CustomFiltersScenario } from './scenarios/custom-filters';
import { PropertiesAndBusinessesScenario } from './scenarios/properties-and-businesses';
import { PropertiesOnlyScenario } from './scenarios/properties-only';

interface ITab {
  id: string;
  label: string;
  description: string;
  render: () => ReactNode;
}

const TABS: ITab[] = [
  {
    id: 'properties-only',
    label: 'Properties only',
    description:
      'The main-entry, self-contained ListingApp: one dataset, the shipped rental filters, the rental preset PropertyCard, and event-based URL sync (initialFilters + onFiltersChange).',
    render: () => <PropertiesOnlyScenario />,
  },
  {
    id: 'properties-and-businesses',
    label: 'Properties + businesses',
    description: 'The same self-contained ListingApp, with a second nearby-businesses marker layer composed alongside the properties dataset.',
    render: () => <PropertiesAndBusinessesScenario />,
  },
  {
    id: 'custom-components',
    label: 'Custom components',
    description: 'ListingComponentsProvider with an app-authored Card and Empty slot.',
    render: () => <CustomComponentsScenario />,
  },
  {
    id: 'custom-filters',
    label: 'Custom filters',
    description: 'withFilters(reg => reg.add/remove/reorder) mutating the shipped rental filter set.',
    render: () => <CustomFiltersScenario />,
  },
];

/**
 * No react-router here on purpose (keeps this example's dependency surface
 * minimal, per the task brief) -- just an in-memory active-tab index driving
 * which scenario mounts. Each tab remounts its scenario's `<ListingProvider>`
 * from scratch when selected (React unmounts the previous branch), which is
 * fine/desirable here: every scenario is a self-contained demonstration of
 * one composition, not shared state across tabs.
 */
export function App() {
  const [activeId, setActiveId] = useState<string>(TABS[0].id);
  const activeTab = TABS.find(tab => tab.id === activeId) ?? TABS[0];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          <h1 className="text-base font-semibold text-foreground">
            react-listing-engine <span className="font-normal text-muted-foreground">-- basic example</span>
          </h1>
        </div>
        <nav className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Scenario">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              onClick={() => setActiveId(tab.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium motion-safe:transition-colors ${
                tab.id === activeId
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <p className="mt-2 text-xs text-muted-foreground">{activeTab.description}</p>
      </header>

      <main className="min-h-0 flex-1 bg-muted">{activeTab.render()}</main>
    </div>
  );
}
