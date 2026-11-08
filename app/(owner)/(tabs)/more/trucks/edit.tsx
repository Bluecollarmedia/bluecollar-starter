import { useLocalSearchParams } from 'expo-router';
import { TruckForm } from '@/components/trucks/TruckForm';

/** Edit an existing truck: name, make, model, year, plate, VIN, color, status, photo, notes. */
export default function EditTruckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TruckForm truckId={id} />;
}
