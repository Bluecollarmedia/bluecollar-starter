import { MyRouteScreen } from '@/components/snow/routes/MyRouteScreen';

/** Settings > Past storms: the storms this worker finished, kept off the Route tab so a running storm has the whole screen. */
export default function PastStorms() {
  return <MyRouteScreen pastOnly />;
}
