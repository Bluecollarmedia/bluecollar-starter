export type TruckStatus = 'available' | 'assigned' | 'maintenance' | 'out_of_service';

export interface Truck {
  id: string;
  companyId: string;
  name: string;
  make?: string;
  model?: string;
  year?: number;
  licensePlate?: string;
  vin?: string;
  color?: string;
  photoUrl?: string;
  status: TruckStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  assignedTo?: string;
  assigneeName?: string;
}

export interface DailyTruckAssignment {
  id: string;
  companyId: string;
  truckId: string;
  personId: string;
  assignedDate: string;
  createdAt: string;
}

/** An insurance card, registration, inspection or any PDF/photo kept for one truck. Owner only. */
export interface TruckDocument {
  id: string;
  companyId: string;
  truckId: string;
  kind: 'insurance' | 'registration' | 'inspection' | 'other';
  title: string;
  fileUrl: string;
  fileKey?: string;
  contentType?: string;
  sizeBytes?: number;
  /** YYYY-MM-DD */
  expiresOn?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** One entry in a truck's maintenance log: what was done, when, and when it is next due. Owner only. */
export interface TruckMaintenance {
  id: string;
  companyId: string;
  truckId: string;
  title: string;
  /** YYYY-MM-DD: the day the service was done. */
  servicedOn: string;
  /** YYYY-MM-DD: when it is next due. The owner is reminded on this day. */
  dueOn?: string;
  /** What was done. */
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** The owner's private dated note about one truck. Nobody else can see it. */
export interface TruckNote {
  id: string;
  companyId: string;
  truckId: string;
  body: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}
