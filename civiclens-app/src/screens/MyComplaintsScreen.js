import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { Colors, Shadows, Radius, FontSize, Spacing } from '../constants/design';

const STATUS_CONFIG = {
  Submitted: { color: Colors.status.Submitted, icon: '📝' },
  Processing: { color: Colors.status.Processing, icon: '⚙️' },
  'Low-Confidence': { color: Colors.status['Low-Confidence'], icon: '⚠️' },
  Assigned: { color: Colors.status.Assigned, icon: '👤' },
  'In Progress': { color: Colors.status['In Progress'], icon: '🔧' },
  Resolved: { color: Colors.status.Resolved, icon: '✅' },
  Closed: { color: Colors.status.Closed, icon: '🔒' },
  Reopened: { color: Colors.status.Reopened, icon: '🔄' },
  Escalated: { color: Colors.status.Escalated, icon: '🚨' },
};

export default function MyComplaintsScreen({ navigation }) {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchComplaints = useCallback(async () => {
    const { data, error } = await supabase
      .from('complaints')
      .select('id, description, category, severity, status, photo_url, created_at')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setComplaints(data);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchComplaints();
  }, [fetchComplaints]);

  // Refresh when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchComplaints();
    });
    return unsubscribe;
  }, [navigation, fetchComplaints]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchComplaints();
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const renderComplaint = ({ item }) => {
    const config = STATUS_CONFIG[item.status] || { color: Colors.textMuted, icon: '❓' };

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('ComplaintDetail', { complaintId: item.id })}
      >
        {/* Thumbnail */}
        {item.photo_url ? (
          <Image source={{ uri: item.photo_url }} style={styles.thumbnail} />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
            <Text style={{ fontSize: 20 }}>📷</Text>
          </View>
        )}

        {/* Content */}
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardCategory}>
              {item.category === 'pending' ? 'Classifying…' : item.category?.toUpperCase()}
            </Text>
            <Text style={styles.cardTime}>{formatDate(item.created_at)}</Text>
          </View>

          <Text style={styles.cardDescription} numberOfLines={2}>
            {item.description || 'No description provided'}
          </Text>

          {/* Status & Severity Badges */}
          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: config.color + '18' }]}>
              <Text style={styles.statusIcon}>{config.icon}</Text>
              <Text style={[styles.statusText, { color: config.color }]}>
                {item.status}
              </Text>
            </View>
            {item.severity && (
              <View style={[styles.severityChip, {
                backgroundColor: item.severity === 'high' ? '#FEE2E2' : item.severity === 'medium' ? '#FEF3C7' : '#DCFCE7'
              }]}>
                <Text style={[styles.severityChipText, {
                  color: item.severity === 'high' ? '#DC2626' : item.severity === 'medium' ? '#D97706' : '#16A34A'
                }]}>
                  {item.severity}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Chevron */}
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />
      <FlatList
        data={complaints}
        keyExtractor={(item) => item.id}
        renderItem={renderComplaint}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>No complaints yet</Text>
            <Text style={styles.emptySubtitle}>
              Report your first civic issue to get started
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => navigation.navigate('Submit')}
            >
              <Text style={styles.emptyButtonText}>Report an Issue</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },

  // Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.small,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: Radius.md,
    marginRight: Spacing.md,
  },
  thumbnailPlaceholder: {
    backgroundColor: Colors.borderLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  cardCategory: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  cardTime: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  cardDescription: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  statusIcon: {
    fontSize: 11,
    marginRight: 4,
  },
  statusText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  severityChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  severityChipText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  chevron: {
    fontSize: 24,
    color: Colors.textMuted,
    marginLeft: Spacing.sm,
  },

  // Empty state
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: Spacing.xxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: Spacing.base,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  emptyButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
  },
  emptyButtonText: {
    color: Colors.white,
    fontSize: FontSize.base,
    fontWeight: '600',
  },
});
