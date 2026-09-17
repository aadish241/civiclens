import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { Colors, Shadows, Radius, FontSize, Spacing } from '../constants/design';

export default function HomeScreen({ navigation }) {
  const [stats, setStats] = useState({
    submitted: 0,
    inProgress: 0,
    resolved: 0,
    needsReview: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('complaints')
        .select('status');

      if (!error && data) {
        let submitted = 0;
        let inProgress = 0;
        let resolved = 0;
        let needsReview = 0;

        data.forEach((item) => {
          const s = item.status;
          if (s === 'Submitted' || s === 'Processing' || s === 'Low-Confidence') {
            // Citizen submitted complaints in intake or awaiting verification
            submitted++;
            if (s === 'Low-Confidence') {
              needsReview++;
            }
          } else if (['Assigned', 'In Progress', 'Escalated', 'Reopened'].includes(s)) {
            // Only verified civic complaints dispatched to field crews
            inProgress++;
          } else if (['Resolved', 'Closed'].includes(s)) {
            resolved++;
          }
        });

        setStats({ submitted, inProgress, resolved, needsReview });
      }
    } catch (err) {
      console.warn('Failed to load complaint stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Refresh counts when navigating back to Home
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchStats();
    });
    return unsubscribe;
  }, [navigation, fetchStats]);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brand}>🏛️ CivicLens</Text>
          <Text style={styles.tagline}>
            Report civic issues. Track accountability.
          </Text>
        </View>

        {/* Action Cards */}
        <View style={styles.cards}>
          {/* New Complaint */}
          <TouchableOpacity
            style={[styles.card, styles.cardPrimary]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Submit')}
          >
            <View style={styles.cardIcon}>
              <Text style={styles.cardEmoji}>📸</Text>
            </View>
            <Text style={styles.cardTitle}>Report an Issue</Text>
            <Text style={styles.cardDescription}>
              Take a photo and submit a complaint. AI classifies and routes it automatically.
            </Text>
            <View style={styles.cardArrow}>
              <Text style={styles.cardArrowText}>→</Text>
            </View>
          </TouchableOpacity>

          {/* My Complaints */}
          <TouchableOpacity
            style={[styles.card, styles.cardSecondary]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('MyComplaints')}
          >
            <View style={styles.cardIcon}>
              <Text style={styles.cardEmoji}>📋</Text>
            </View>
            <Text style={styles.cardTitleDark}>My Complaints</Text>
            <Text style={styles.cardDescriptionDark}>
              View all your past reports and track their real-time status.
            </Text>
            <View style={styles.cardArrowDark}>
              <Text style={styles.cardArrowTextDark}>→</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Live Municipal Stats Bar */}
        <TouchableOpacity
          style={styles.statsCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('MyComplaints')}
        >
          <View style={styles.statsBar}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>
                {loading ? '…' : stats.submitted}
              </Text>
              <Text style={styles.statLabel}>Submitted</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: Colors.primary }]}>
                {loading ? '…' : stats.inProgress}
              </Text>
              <Text style={styles.statLabel}>In Progress</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: Colors.accent }]}>
                {loading ? '…' : stats.resolved}
              </Text>
              <Text style={styles.statLabel}>Resolved</Text>
            </View>
          </View>

          {stats.needsReview > 0 && (
            <View style={styles.reviewNotice}>
              <Text style={styles.reviewNoticeIcon}>🛡️</Text>
              <Text style={styles.reviewNoticeText}>
                {stats.needsReview} reported item{stats.needsReview > 1 ? 's' : ''} held for human verification
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  container: {
    flex: 1,
    padding: Spacing.xl,
    paddingTop: Spacing.xxl,
  },
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
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
    lineHeight: 22,
  },

  // Cards
  cards: {
    gap: Spacing.base,
    marginBottom: Spacing.xl,
  },
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    position: 'relative',
    overflow: 'hidden',
    ...Shadows.medium,
  },
  cardPrimary: {
    backgroundColor: Colors.primary,
  },
  cardSecondary: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  cardEmoji: {
    fontSize: 22,
  },
  cardTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textInverse,
    marginBottom: Spacing.xs,
  },
  cardTitleDark: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  cardDescription: {
    fontSize: FontSize.sm,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  cardDescriptionDark: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  cardArrow: {
    position: 'absolute',
    right: Spacing.xl,
    top: Spacing.xl,
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardArrowText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  cardArrowDark: {
    position: 'absolute',
    right: Spacing.xl,
    top: Spacing.xl,
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardArrowTextDark: {
    color: Colors.primary,
    fontSize: FontSize.md,
    fontWeight: '600',
  },

  // Stats
  statsCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadows.small,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: FontSize.xl,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.border,
  },
  reviewNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  reviewNoticeIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  reviewNoticeText: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    fontWeight: '500',
  },
});
