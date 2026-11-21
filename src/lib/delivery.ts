import {
  CdekCity,
  CdekDeliveryPoint,
  PickupStore,
  MARIO_MIKKE_PICKUP_STORES,
  searchCdekCities,
  fetchCdekDeliveryPoints,
} from "./cdek";
import {
  PochtaPostOffice,
  fetchPostOffices,
} from "./pochta";

export type DeliveryProviderType = "cdek" | "pochta" | "pickup";

export interface UnifiedDeliveryOption {
  id: string;
  provider: DeliveryProviderType;
  title: string;
  subtitle: string;
  badge?: string;
  customerCost: number;
  periodText: string;
  requiresPvzSelect?: boolean;
  requiresStoreSelect?: boolean;
}

export {
  // CDEK
  searchCdekCities,
  fetchCdekDeliveryPoints,
  MARIO_MIKKE_PICKUP_STORES,
  // Pochta
  fetchPostOffices,
};

export type {
  CdekCity,
  CdekDeliveryPoint,
  PickupStore,
  PochtaPostOffice,
};
