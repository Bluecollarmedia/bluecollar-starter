import { SnowTabs } from '@/components/snow/SnowTabs';

export default function SnowOwnerTabsLayout() {
  return (
    <SnowTabs
      tabs={[
        { name: 'index', title: 'Dashboard', feather: 'home', sf: { default: 'house', selected: 'house.fill' } },
        { name: 'storms', title: 'Storms', feather: 'cloud-snow', sf: { default: 'cloud.snow', selected: 'cloud.snow.fill' } },
        { name: 'properties', title: 'Properties', feather: 'map-pin', sf: { default: 'building.2', selected: 'building.2.fill' } },
        { name: 'team', title: 'Team', feather: 'users', sf: { default: 'person.2', selected: 'person.2.fill' } },
        { name: 'more', title: 'More', feather: 'menu', sf: 'ellipsis' },
      ]}
    />
  );
}
