import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import { Listing, StoreName } from '../types';

const STORE_LABELS: Record<StoreName, string> = {
  reliance_digital: 'Reliance Digital',
  croma: 'Croma',
  vijay_sales: 'Vijay Sales',
  sony_center: 'Sony Center',
  games_the_shop: 'Games The Shop',
  flipkart: 'Flipkart',
  amazon: 'Amazon',
};

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
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        Pincode {listing.pincode} · checked {relativeTime(listing.last_checked_at)}
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
  meta: {
    fontSize: 12,
  },
});
