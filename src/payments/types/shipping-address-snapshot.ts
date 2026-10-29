export interface ShippingAddressSnapshot {
  fullName: string;
  phone: string;
  country: string;
  province: string;
  city: string;
  line1: string;
  line2: string | null;
  postalCode: string | null;
  notes: string | null;
}
