import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, Text, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';

import { useTheme } from '../contexts/ThemeContext';
import api from '../services/api';
import { Listing } from '../types';
import ListingCard from '../components/ListingCard';

export default function ListingsScreen() {
  const { colors } = useTheme();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={listings.length === 0 ? styles.emptyContainer : styles.listContainer}
      data={listings}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => <ListingCard listing={item} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={{ color: colors.textSecondary }}>
            No listings tracked yet. Add one via the server's add_listing.php CLI script.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  listContainer: {
    paddingTop: 12,
    paddingBottom: 24,
  },
  emptyContainer: {
    flexGrow: 1,
  },
});
