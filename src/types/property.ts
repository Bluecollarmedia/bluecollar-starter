/** One place, owned by one customer (supabase/updates/075). Landscaping projects, Maintenance and Snow all link to it by property_id. */
export interface Property {
  id: string;
  companyId: string;
  customerId?: string;
  /** Optional nickname, like "Rushmore Plaza". */
  name?: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  addressKey?: string;
  isActive?: boolean;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}
