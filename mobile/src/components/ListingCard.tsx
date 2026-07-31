import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { Listing, StoreName, LOCAL_CRAWLER_STORES, BACKUP_STORES } from '../types';

const STORE_LABELS: Record<StoreName, string> = {
  reliance_digital: 'Reliance Digital',
  croma: 'Croma',
  vijay_sales: 'Vijay Sales',
  sony_center: 'Sony Center',
  games_the_shop: 'Games The Shop',
  flipkart: 'Flipkart',
  amazon: 'Amazon',
  blinkit: 'Blinkit',
  instamart: 'Instamart',
  zepto: 'Zepto',
  md_computers: 'MD Computers',
};

function polledByLabel(store: StoreName): string {
  if (LOCAL_CRAWLER_STORES.includes(store)) return 'local crawler';
  if (BACKUP_STORES.includes(store)) return 'server cron (+ local backup)';
  return 'server cron';
}

function statusColor(status: Listing['last_status'], colors: ReturnType<typeof useTheme>['colors']) {
  switch (status) {
    case 'in_stock':
      return colors.success;
    case 'out_of_stock':
      return colors.textSecondary;
    case 'blocked':
    case 'error':
      return colors.error;
    default:
      return colors.textSecondary;
  }
}

function statusLabel(status: Listing['last_status']) {
  switch (status) {
    case 'in_stock':
      return 'In stock!';
    case 'out_of_stock':
      return 'Out of stock';
    case 'blocked':
      return 'Blocked';
    case 'error':
      return 'Error';
    default:
      return 'Unknown';
  }
}

function formatInr(value: string | number | null): string | null {
  if (value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return '₹' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never checked';
  const diffMs = Date.now() - new Date(iso.replace(' ', 'T')).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const { colors } = useTheme();
  const polledBy = polledByLabel(listing.store);
  const price = formatInr(listing.last_price);
  // A listing priced above its cap is tracked but won't push on restock — say so rather than
  // letting it look like a live alert (the disc edition is ~₹69,990 at several stores now).
  const cap = Number(listing.effective_max_notify_price ?? 0);
  const mutedByPrice = price !== null && cap > 0 && Number(listing.last_price) > cap;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => Linking.openURL(listing.url)}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        <View style={[styles.storeBadge, { backgroundColor: colors.badgeBg }]}>
          <Text style={[styles.storeBadgeText, { color: colors.primary }]}>{STORE_LABELS[listing.store]}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusColor(listing.last_status, colors) }]}>
          <Text style={styles.statusPillText}>{statusLabel(listing.last_status)}</Text>
        </View>
      </View>
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
        {listing.product_name || listing.url}
      </Text>
      <Text style={[styles.url, { color: colors.primary }]} numberOfLines={1}>
        {listing.url}
      </Text>
      {price !== null && (
        <Text style={[styles.price, { color: mutedByPrice ? colors.textSecondary : colors.text }]}>
          {price}
          {mutedByPrice ? `  ·  above ${formatInr(cap)} alert cap — no push` : ''}
        </Text>
      )}
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        Pincode {listing.pincode} · checked {relativeTime(listing.last_checked_at)} · {polledBy}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  storeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  storeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  url: {
    fontSize: 11,
    marginBottom: 6,
  },
  price: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  meta: {
    fontSize: 12,
  },
});
