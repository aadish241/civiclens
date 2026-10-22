import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  StatusBar,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { Colors, Shadows, Radius, FontSize, Spacing } from '../constants/design';

const STATUS_CONFIG = {
  Submitted:       { color: '#6366F1', icon: '📝', label: 'Submitted' },
  Processing:      { color: '#8B5CF6', icon: '⚙️', label: 'AI Processing' },
  'Low-Confidence':{ color: '#D97706', icon: '⚠️', label: 'Human Review' },
  Assigned:        { color: '#0284C7', icon: '👤', label: 'Assigned' },
  'In Progress':   { color: '#2563EB', icon: '🔧', label: 'In Progress' },
  Resolved:        { color: '#059669', icon: '✅', label: 'Resolved' },
  Closed:          { color: '#64748B', icon: '🔒', label: 'Closed' },
  Reopened:        { color: '#DC2626', icon: '🔄', label: 'Reopened' },
  Escalated:       { color: '#DC2626', icon: '🚨', label: 'Escalated' },
};

export default function HomeScreen({ navigation }) {
  const [displayName, setDisplayName] = useState('');
  const [lastComplaint, setLastComplaint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setLoading(false);
        return;
      }

      // Get display name
      const { data: userData } = await supabase
        .from('users')
        .select('display_name')
        .eq('id', userId)
        .single();

      setDisplayName(
        userData?.display_name || session.user.email?.split('@')[0] || 'Citizen'
      );

      // Get last complaint
      const { data: complaints } = await supabase
        .from('complaints')
        .select('id, category, status, photo_url, ai_description, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (complaints && complaints.length > 0) {
        setLastComplaint(complaints[0]);
      }
    } catch (err) {
      console.warn('HomeScreen fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchData();
    });
    return unsubscribe;
  }, [navigation, fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
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
    return `${days}d ago`;
  };

  const statusCfg = lastComplaint
    ? STATUS_CONFIG[lastComplaint.status] || { color: '#64748B', icon: '❓', label: lastComplaint.status }
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brand}>🏛️ CivicLens</Text>
          <Text style={styles.tagline}>
            Report civic issues. Track accountability.
          </Text>
        </View>

        {/* Welcome */}
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeText}>Welcome back,</Text>
          <Text style={styles.userName}>
            {loading ? '...' : displayName} 👋
          </Text>
        </View>

        {/* Last Complaint */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Latest Report</Text>
        </View>

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        ) : lastComplaint ? (
          <TouchableOpacity
            style={styles.complaintCard}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ComplaintDetail', { complaintId: lastComplaint.id })}
          >
            {/* Photo strip */}
            {lastComplaint.photo_url ? (
              <Image source={{ uri: lastComplaint.photo_url }} style={styles.complaintPhoto} />
            ) : (
              <View style={[styles.complaintPhoto, styles.photoPlaceholder]}>
                <Text style={styles.photoPlaceholderText}>📷</Text>
              </View>
            )}

            <View style={styles.complaintBody}>
              {/* Status badge */}
              <View style={[styles.statusBadge, { backgroundColor: statusCfg.color + '15' }]}>
                <Text style={[styles.statusText, { color: statusCfg.color }]}>
                  {statusCfg.icon} {statusCfg.label}
                </Text>
              </View>

              {/* Description */}
              <Text style={styles.complaintDesc} numberOfLines={2}>
                {lastComplaint.ai_description || lastComplaint.category || 'Civic issue reported'}
              </Text>

              {/* Meta */}
              <View style={styles.complaintMeta}>
                <Text style={styles.metaText}>
                  {(lastComplaint.category || 'pending').replace(/_/g, ' ')}
                </Text>
                <Text style={styles.metaDot}>•</Text>
                <Text style={styles.metaText}>{timeAgo(lastComplaint.created_at)}</Text>
              </View>

              <Text style={styles.tapHint}>Tap to view full details →</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>No reports yet</Text>
            <Text style={styles.emptySubtitle}>
              Submit your first civic complaint to start tracking it here.
            </Text>
          </View>
        )}

        {/* Report New Issue Button */}
        <TouchableOpacity
          style={styles.reportButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('SubmitTab')}
        >
          <Text style={styles.reportButtonIcon}>📸</Text>
          <View style={styles.reportButtonTextWrap}>
            <Text style={styles.reportButtonTitle}>Report New Issue</Text>
            <Text style={styles.reportButtonSub}>
              Take a photo and let AI classify it instantly
            </Text>
          </View>
          <Text style={styles.reportArrow}>→</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxxl,
  },

  // Header
  header: {
    marginBottom: Spacing.xxl,
  },
  brand: {
    fontSize: FontSize.xxl,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },

  // Welcome
  welcomeSection: {
    marginBottom: Spacing.xxl,
  },
  welcomeText: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
  },
  userName: {
    fontSize: FontSize.xl,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 2,
  },

  // Section
  sectionHeader: {
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Loading
  loadingCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.xxxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
  },

  // Complaint card
  complaintCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
    ...Shadows.medium,
  },
  complaintPhoto: {
    width: '100%',
    height: 160,
    backgroundColor: Colors.borderLight,
  },
  photoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoPlaceholderText: {
    fontSize: 36,
  },
  complaintBody: {
    padding: Spacing.base,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.sm,
  },
  statusText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  complaintDesc: {
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    lineHeight: 22,
    marginBottom: Spacing.sm,
  },
  complaintMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  metaText: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textTransform: 'capitalize',
  },
  metaDot: {
    marginHorizontal: 6,
    color: Colors.textMuted,
    fontSize: FontSize.xs,
  },
  tapHint: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    fontWeight: '600',
  },

  // Empty state
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xl,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Report button
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadows.medium,
  },
  reportButtonIcon: {
    fontSize: 28,
    marginRight: Spacing.md,
  },
  reportButtonTextWrap: {
    flex: 1,
  },
  reportButtonTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.white,
  },
  reportButtonSub: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  reportArrow: {
    fontSize: FontSize.xl,
    color: Colors.white,
    fontWeight: '700',
  },
});
