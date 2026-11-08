/** Every Spanish phrase in one place: the core set (sign-in, tab bars, Settings) plus one file per area of the app. */
import { ES } from './es';
import { ES_WORKER } from './es.worker';
import { ES_MAINTENANCE } from './es.maintenance';
import { ES_SNOW } from './es.snow';
import { ES_CUSTOMER } from './es.customer';
import { ES_WEATHER } from './es.weather';

export const DICTIONARY: Record<string, string> = { ...ES_WORKER, ...ES_MAINTENANCE, ...ES_SNOW, ...ES_CUSTOMER, ...ES_WEATHER, ...ES };
