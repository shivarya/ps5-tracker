export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string | null;
}

export type StoreName =
  | 'reliance_digital'
  | 'croma'
  | 'vijay_sales'
  | 'sony_center'
  | 'games_the_shop'
  | 'flipkart'
  | 'amazon';

export type ListingStatus = 'unknown' | 'in_stock' | 'out_of_stock' | 'blocked' | 'error';

export interface Listing {
  id: number;
  store: StoreName;
  url: string;
  product_name: string | null;
  pincode: string;
  is_active: 0 | 1;
  last_status: ListingStatus;
  last_checked_at: string | null;
  last_status_changed_at: string | null;
}
