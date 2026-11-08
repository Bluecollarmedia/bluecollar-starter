import { SnowTabs } from '@/components/snow/SnowTabs';

// Every Snow worker, on a route or not, lands on Route: that is where "Clock in for the storm" is.
export default function SnowWorkerTabsLayout() {
  return (
    <SnowTabs
      tabs={[
        { name: 'index', title: 'Route', feather: 'navigation', sf: { default: 'map', selected: 'map.fill' } },
        { name: 'time', title: 'Time Clock', feather: 'clock', sf: { default: 'clock', selected: 'clock.fill' } },
        { name: 'settings', title: 'Settings', feather: 'settings', sf: { default: 'gearshape', selected: 'gearshape.fill' } },
      ]}
    />
  );
}
