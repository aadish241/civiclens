import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { Colors, Shadows, Radius, FontSize, Spacing } from '../constants/design';

// Only show complaints actively being worked on by the municipality
const VISIBLE_STATUSES = ['Assigned', 'In Progress', 'Escalated'];

const RADIUS_KM = 5; // Show complaints within 5 km

const STATUS_CONFIG = {
  Assigned:      { color: '#0284C7', icon: '👤', label: 'Assigned' },
  'In Progress': { color: '#2563EB', icon: '🔧', label: 'In Progress' },
  Escalated:     { color: '#DC2626', icon: '🚨', label: 'Escalated' },
  Resolved:      { color: '#059669', icon: '✅', label: 'Resolved' },
};

const CATEGORY_ICONS = {
  pothole: '🕳️',
  garbage: '🗑️',
  streetlight: '💡',
  water_leak: '💧',
  sewage: '🚰',
  road_damage: '🛣️',
  other: '📋',
  pending: '⏳',
};

// Haversine formula — returns distance in km between two GPS points
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function NeighbourhoodScreen({ navigation }) {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState(null);
  const [upvotedIds, setUpvotedIds] = useState(new Set());
  const [upvotingId, setUpvotingId] = useState(null); // prevents double-tap
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);

  useEffect(() => {
    initUser();
    detectLocation();
  }, []);

  useEffect(() => {
    if (userId && userLocation) {
      fetchComplaints();
    }
  }, [userId, userLocation]);

  const initUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      setUserId(session.user.id);
    }
  };

  const detectLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied. Showing all active complaints.');
        // Still allow fetching without filtering
        setUserLocation({ latitude: null, longitude: null });
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch (err) {
      console.warn('Location detection failed:', err);
      setLocationError('Could not detect location. Showing all active complaints.');
      setUserLocation({ latitude: null, longitude: null });
    }
  };

  const fetchComplaints = useCallback(async () => {
    try {
      // Fetch complaints that are actively being processed by municipality
      const { data, error } = await supabase
        .from('complaints')
        .select('id, category, severity, status, photo_url, ai_description, latitude, longitude, upvote_count, created_at, updated_at')
        .in('status', VISIBLE_STATUSES)
        .order('upvote_count', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200); // fetch more, then filter by distance

      if (error) throw error;

      let filtered = data || [];

      // Filter by proximity if we have the user's location
      if (userLocation?.latitude != null && userLocation?.longitude != null) {
        filtered = filtered.filter(c => {
          if (c.latitude == null || c.longitude == null) return false;
          const dist = haversineKm(
            userLocation.latitude, userLocation.longitude,
            c.latitude, c.longitude
          );
          c._distanceKm = Math.round(dist * 10) / 10; // attach for display
          return dist <= RADIUS_KM;
        });
        // Sort nearest first, then by upvotes
        filtered.sort((a, b) => a._distanceKm - b._distanceKm);
      }

      setComplaints(filtered);

      // Fetch which ones the current user has upvoted
      if (userId) {
        const { data: upvotes } = await supabase
          .from('complaint_upvotes')
          .select('complaint_id')
          .eq('user_id', userId);

        if (upvotes) {
          setUpvotedIds(new Set(upvotes.map(u => u.complaint_id)));
        }
      }
    } catch (err) {
      console.error('Failed to fetch neighbourhood complaints:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, userLocation]);

  const handleUpvote = async (complaintId) => {
    if (upvotingId) return; // prevent double-tap
    setUpvotingId(complaintId);

    const alreadyUpvoted = upvotedIds.has(complaintId);

    try {
      if (alreadyUpvoted) {
        // Remove upvote
        const { error } = await supabase
          .from('complaint_upvotes')
          .delete()
          .eq('complaint_id', complaintId)
          .eq('user_id', userId);

        if (error) throw error;

        // Optimistic update
        setUpvotedIds(prev => {
          const next = new Set(prev);
          next.delete(complaintId);
          return next;
        });
        setComplaints(prev =>
          prev.map(c =>
            c.id === complaintId
              ? { ...c, upvote_count: Math.max((c.upvote_count || 0) - 1, 0) }
              : c
          )
        );
      } else {
        // Add upvote
        const { error } = await supabase
          .from('complaint_upvotes')
          .insert({ complaint_id: complaintId, user_id: userId });

        if (error) throw error;

        // Optimistic update
        setUpvotedIds(prev => new Set(prev).add(complaintId));
        setComplaints(prev =>
          prev.map(c =>
            c.id === complaintId
              ? { ...c, upvote_count: (c.upvote_count || 0) + 1 }
              : c
          )
        );
      }
    } catch (err) {
      console.error('Upvote error:', err);
      Alert.alert('Error', 'Could not update your vote. Try again.');
    } finally {
      setUpvotingId(null);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    detectLocation(); // re-detect location
    fetchComplaints();
  };

  const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  };

  const renderComplaint = ({ item }) => {
    const statusCfg = STATUS_CONFIG[item.status] || { color: '#64748B', icon: '❓', label: item.status };
    const categoryIcon = CATEGORY_ICONS[item.category] || '📋';
    const isUpvoted = upvotedIds.has(item.id);
    const isUpvoting = upvotingId === item.id;
    const count = item.upvote_count || 0;

    return (
      <View style={styles.card}>
        {/* Photo */}
        {item.photo_url ? (
          <Image source={{ uri: item.photo_url }} style={styles.cardPhoto} />
        ) : (
          <View style={[styles.cardPhoto, styles.cardPhotoPlaceholder]}>
            <Text style={styles.placeholderText}>{categoryIcon}</Text>
          </View>
        )}

        {/* Content */}
        <View style={styles.cardBody}>
          {/* Category + Status Row */}
          <View style={styles.cardTopRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>
                {categoryIcon} {(item.category || 'other').replace(/_/g, ' ')}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusCfg.color + '18' }]}>
              <Text style={[styles.statusText, { color: statusCfg.color }]}>
                {statusCfg.icon} {statusCfg.label}
              </Text>
            </View>
          </View>

          {/* AI Description — anonymous, no user info */}
          <Text style={styles.description} numberOfLines={3}>
            {item.ai_description || 'Civic issue reported in the neighbourhood.'}
          </Text>

          {/* Severity + Time + Distance */}
          <View style={styles.metaRow}>
            {item.severity && (
              <View style={[
                styles.severityDot,
                { backgroundColor: item.severity === 'high' ? Colors.danger : item.severity === 'medium' ? Colors.warning : Colors.success }
              ]} />
            )}
            {item.severity && (
              <Text style={styles.metaText}>
                {item.severity.charAt(0).toUpperCase() + item.severity.slice(1)} severity
              </Text>
            )}
            <Text style={styles.metaDivider}>•</Text>
            <Text style={styles.metaText}>{timeAgo(item.created_at)}</Text>
            {item._distanceKm != null && (
              <>
                <Text style={styles.metaDivider}>•</Text>
                <Text style={styles.metaText}>📍 {item._distanceKm} km away</Text>
              </>
            )}
          </View>

          {/* Upvote Bar */}
          <View style={styles.upvoteRow}>
            <TouchableOpacity
              style={[
                styles.upvoteButton,
                isUpvoted && styles.upvoteButtonActive,
              ]}
              onPress={() => handleUpvote(item.id)}
              disabled={isUpvoting}
              activeOpacity={0.7}
            >
              {isUpvoting ? (
                <ActivityIndicator size="small" color={isUpvoted ? Colors.white : Colors.primary} />
              ) : (
                <>
                  <Text style={[styles.upvoteIcon, isUpvoted && styles.upvoteIconActive]}>
                    {isUpvoted ? '▲' : '△'}
                  </Text>
                  <Text style={[styles.upvoteText, isUpvoted && styles.upvoteTextActive]}>
                    {isUpvoted ? 'Upvoted' : 'Upvote'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.upvoteCount}>
              {count} {count === 1 ? 'resident' : 'residents'} want{count === 1 ? 's' : ''} this fixed
            </Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading neighbourhood issues...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>🏘️ Neighbourhood</Text>
          <Text style={styles.headerSubtitle}>
            {locationError
              ? locationError
              : userLocation?.latitude
                ? `Within ${RADIUS_KM} km of your location`
                : 'Detecting your location...'}
          </Text>
        </View>
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {VISIBLE_STATUSES.map(status => {
          const cfg = STATUS_CONFIG[status];
          return (
            <View key={status} style={[styles.filterChip, { borderColor: cfg.color + '40' }]}>
              <Text style={[styles.filterChipText, { color: cfg.color }]}>
                {cfg.icon} {cfg.label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Complaints List */}
      <FlatList
        data={complaints}
        keyExtractor={(item) => item.id}
        renderItem={renderComplaint}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🏘️</Text>
            <Text style={styles.emptyTitle}>No active complaints</Text>
            <Text style={styles.emptySubtitle}>
              There are no complaints currently being processed by the municipality. Check back later!
            </Text>
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
    padding: Spacing.xl,
  },
  loadingText: {
    marginTop: Spacing.md,
    color: Colors.textSecondary,
    fontSize: FontSize.base,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.white,
  },
  backButton: {
    width: 50,
  },
  backText: {
    color: Colors.primary,
    fontSize: FontSize.base,
    fontWeight: '600',
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
  },
  headerTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },

  // Filter chips
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },

  // List
  listContent: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    marginBottom: Spacing.base,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.small,
  },
  cardPhoto: {
    width: '100%',
    height: 180,
    backgroundColor: Colors.borderLight,
  },
  cardPhotoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 40,
  },
  cardBody: {
    padding: Spacing.base,
  },

  // Top row
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  categoryBadge: {
    backgroundColor: Colors.primaryGhost,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  categoryText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.primary,
    textTransform: 'capitalize',
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
  },
  statusText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },

  // Description
  description: {
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    lineHeight: 22,
    marginBottom: Spacing.sm,
  },

  // Meta row
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  metaText: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  metaDivider: {
    marginHorizontal: 6,
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },

  // Upvote
  upvoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  upvoteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
    marginRight: Spacing.md,
  },
  upvoteButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  upvoteIcon: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: '800',
    marginRight: 6,
  },
  upvoteIconActive: {
    color: Colors.white,
  },
  upvoteText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.primary,
  },
  upvoteTextActive: {
    color: Colors.white,
  },
  upvoteCount: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    flex: 1,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: Spacing.md,
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
    paddingHorizontal: Spacing.xl,
  },
});
