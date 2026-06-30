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
  | 'amazon'
  | 'blinkit'
  | 'instamart';

// Stores polled by the local Playwright crawler rather than the server cron worker — kept in sync
// with local-crawler/index.js's LOCAL_STORES and the dashboard's identical constant.
export const LOCAL_CRAWLER_STORES: StoreName[] = [
  'croma',
  'flipkart',
  'games_the_shop',
  'amazon',
  'blinkit',
  'instamart',
];

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
