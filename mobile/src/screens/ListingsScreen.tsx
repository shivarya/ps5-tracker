import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, SectionList, Text, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import api from '../services/api';
import { Listing, Edition, EDITION_LABELS } from '../types';
import ListingCard from '../components/ListingCard';

// Display order for both the filter chips and the grouped sections.
const EDITION_ORDER: Edition[] = ['disc', 'digital', 'pro'];
type EditionFilter = 'all' | Edition;

export default function ListingsScreen() {
  const { colors } = useTheme();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<EditionFilter>('all');

  const load = useCallback(async () => {
    try {
      const res = await api.getStatus();
      // Mirrors the local dashboard's sort (store.localeCompare) so the app and the web
      // dashboard always present tracked listings in the same order.
      const sorted = [...res.data].sort((a, b) => a.store.localeCompare(b.store));
      setListings(sorted);
    } catch (err) {
      console.warn('Failed to load status', err);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    // Poll on the same 30s cadence as the local dashboard, so a fresh crawl result (server
    // cron or local crawler) shows up here without the user needing to pull-to-refresh.
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const sections = useMemo(() => {
    const visible = filter === 'all' ? listings : listings.filter((l) => l.edition === filter);
    const editionsToShow = filter === 'all' ? EDITION_ORDER : [filter];
    return editionsToShow
      .map((edition) => ({
        edition,
        title: EDITION_LABELS[edition],
        data: visible.filter((l) => l.edition === edition),
      }))
      .filter((section) => section.data.length > 0);
  }, [listings, filter]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.filterRow}>
        {(['all', ...EDITION_ORDER] as EditionFilter[]).map((f) => {
          const selected = filter === f;
          const label = f === 'all' ? 'All' : EDITION_LABELS[f];
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: selected ? colors.primary : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.filterChipText, { color: selected ? colors.onPrimary : colors.text }]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <SectionList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={listings.length === 0 ? styles.emptyContainer : styles.listContainer}
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <ListingCard listing={item} />}
        renderSectionHeader={({ section }) =>
          filter === 'all' ? (
            <Text style={[styles.sectionHeader, { color: colors.textSecondary, backgroundColor: colors.background }]}>
              {section.title}
            </Text>
          ) : null
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={{ color: colors.textSecondary }}>
              {listings.length === 0
                ? "No listings tracked yet. Add one via the server's add_listing.php CLI script."
                : `No ${filter === 'all' ? '' : EDITION_LABELS[filter as Edition] + ' '}listings tracked yet.`}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  listContainer: {
    paddingTop: 4,
    paddingBottom: 24,
  },
  emptyContainer: {
    flexGrow: 1,
  },
});
