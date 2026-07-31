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
  | 'instamart'
  | 'zepto'
  | 'md_computers';

// Stores polled by the local Playwright crawler rather than the server cron worker — kept in sync
// with local-crawler/index.js's LOCAL_STORES and the dashboard's identical constant.
export const LOCAL_CRAWLER_STORES: StoreName[] = [
  'croma',
  'flipkart',
  'games_the_shop',
  'amazon',
  'blinkit',
  'instamart',
  'zepto',
  'md_computers',
];

// Server-cron stores the local crawler also backs up when the server-side check is blocked/error
// (index.js's BACKUP_CHECKERS) — not unconditional like LOCAL_CRAWLER_STORES, only a fallback.
export const BACKUP_STORES: StoreName[] = ['reliance_digital', 'vijay_sales', 'sony_center'];

export type ListingStatus = 'unknown' | 'in_stock' | 'out_of_stock' | 'blocked' | 'error';

export type Edition = 'disc' | 'digital' | 'pro';

export const EDITION_LABELS: Record<Edition, string> = {
  disc: 'Disc',
  digital: 'Digital',
  pro: 'Pro',
};

export interface Listing {
  id: number;
  store: StoreName;
  edition: Edition;
  url: string;
  product_name: string | null;
  pincode: string;
  /** Last price a checker read, as a decimal string from MySQL ("54990.00"). Null = unknown. */
  last_price: string | null;
  /** Per-listing push cap; null means the server's global NOTIFY_MAX_PRICE applies. */
  max_notify_price: string | null;
  /** The cap actually in force for this listing, resolved server-side. */
  effective_max_notify_price: number;
  is_active: 0 | 1;
  last_status: ListingStatus;
  last_checked_at: string | null;
  last_status_changed_at: string | null;
}
