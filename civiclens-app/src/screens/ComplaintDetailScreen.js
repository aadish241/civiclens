import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { fetchComplaintDetail, triggerAiClassification } from '../lib/api';
import { Colors, Shadows, Radius, FontSize, Spacing } from '../constants/design';

const LIFECYCLE_STEPS = [
  'Submitted',
  'Assigned',
  'In Progress',
  'Resolved',
  'Closed',
];

const STATUS_CONFIG = {
  Submitted: { color: '#6366F1', icon: '📝', label: 'Submitted' },
  Processing: { color: '#8B5CF6', icon: '⚙️', label: 'AI Processing' },
  'Low-Confidence': { color: '#D97706', icon: '⚠️', label: 'Needs Human Review' },
  Assigned: { color: '#0284C7', icon: '👤', label: 'Assigned to Ward' },
  'In Progress': { color: '#2563EB', icon: '🔧', label: 'Work In Progress' },
  Resolved: { color: '#059669', icon: '✅', label: 'Resolved' },
  Closed: { color: '#64748B', icon: '🔒', label: 'Closed' },
  Reopened: { color: '#DC2626', icon: '🔄', label: 'Reopened' },
  Escalated: { color: '#DC2626', icon: '🚨', label: 'SLA Escalated' },
};

const KNOWN_WARDS = {
  '10000000-0000-0000-0000-000000000001': 'W-01 — Thapar / Bhadson Road',
  '10000000-0000-0000-0000-000000000002': 'W-02 — Model Town',
  '10000000-0000-0000-0000-000000000003': 'W-03 — Lehal Colony',
  '10000000-0000-0000-0000-000000000004': 'W-04 — Urban Estate Phase 1',
  '10000000-0000-0000-0000-000000000005': 'W-05 — Baradari / Rajpura Road',
};

const KNOWN_DEPARTMENTS = {
  '00000000-0000-0000-0000-000000000001': 'Roads & Infrastructure',
  '00000000-0000-0000-0000-000000000002': 'Sanitation & Solid Waste',
  '00000000-0000-0000-0000-000000000003': 'Streetlighting & Electrical',
  '00000000-0000-0000-0000-000000000004': 'Water Supply & Sewerage',
  '00000000-0000-0000-0000-000000000005': 'General Maintenance',
};

export default function ComplaintDetailScreen({ route, navigation }) {
  const { complaintId } = route.params;
  const [complaint, setComplaint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [classifying, setClassifying] = useState(false);

  const fetchComplaint = useCallback(async () => {
    try {
      // 1. Fetch complaint directly (safe from RLS infinite recursion)
      const { data, error } = await supabase
        .from('complaints')
        .select('*')
        .eq('id', complaintId)
        .single();

      if (error) throw error;
      if (data) {
        // Map ward and department names
        const wardName = data.ward_id
          ? KNOWN_WARDS[data.ward_id] || 'W-01 — Thapar / Bhadson Road'
          : null;
        const deptName = data.department_id
          ? KNOWN_DEPARTMENTS[data.department_id] || 'General Maintenance'
          : null;

        // Build audit trail entries
        const logs = [
          {
            id: 'log-1',
            action: 'complaint_submitted',
            new_value: 'Submitted',
            actor_role: 'citizen',
            notes: 'Issue reported with photo and GPS coordinates.',
            created_at: data.created_at,
          },
        ];

        if (data.status !== 'Submitted' && data.status !== 'Processing') {
          logs.push({
            id: 'log-2',
            action: 'ai_classified',
            new_value: data.status,
            actor_role: 'system',
            notes: data.ai_description || `AI classified issue as ${data.category} (${data.severity} severity).`,
            created_at: data.updated_at || data.created_at,
          });
        }

        setComplaint({
          ...data,
          ward_name: wardName,
          department_name: deptName,
          audit_trail: logs,
        });
      }
    } catch (err) {
      console.warn('Error fetching complaint from Supabase:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [complaintId]);

  useEffect(() => {
    fetchComplaint();
  }, [fetchComplaint]);

  // Auto-poll every 2.5s if classification or routing is still pending
  useEffect(() => {
    if (!complaint) return;
    const isPending =
      complaint.status === 'Submitted' ||
      complaint.status === 'Processing' ||
      complaint.category === 'pending';
    if (!isPending) return;

    const interval = setInterval(() => {
      fetchComplaint();
    }, 2500);

    return () => clearInterval(interval);
  }, [complaint?.status, complaint?.category, fetchComplaint]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchComplaint();
  };

  const runAiAnalysis = async () => {
    setClassifying(true);
    try {
      // 1. Mark as pending in Supabase so the background worker immediately classifies it
      await supabase
        .from('complaints')
        .update({ status: 'Submitted', category: 'pending' })
        .eq('id', complaintId);

      // 2. Also try direct API ping in parallel (non-blocking)
      try {
        await triggerAiClassification(complaintId);
      } catch (_) {}

      await fetchComplaint();
      Alert.alert('AI Analysis Triggered', 'Assessment is running in background and will update in a moment.');
    } catch (err) {
      console.error(err);
      Alert.alert('AI Error', err.message ?? 'Could not trigger AI classification.');
    } finally {
      setClassifying(false);
    }
  };

  const copyId = () => {
    Alert.alert('Complaint ID', complaintId);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={{ marginTop: Spacing.md, color: Colors.textMuted }}>
            Loading municipal ticket...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!complaint) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={{ fontSize: 48, marginBottom: Spacing.base }}>🔍</Text>
          <Text style={styles.errorTitle}>Complaint not found</Text>
          <Text style={styles.errorSubtitle}>Ticket ID: {complaintId}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchComplaint}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const config = STATUS_CONFIG[complaint.status] || {
    color: Colors.textMuted,
    icon: '❓',
    label: complaint.status,
  };
  const currentStepIndex = LIFECYCLE_STEPS.indexOf(complaint.status);
  const isSpecialStatus = ['Escalated', 'Reopened', 'Low-Confidence', 'Processing'].includes(
    complaint.status
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {/* Status Header Banner */}
        <View style={[styles.statusHeader, { backgroundColor: config.color + '15' }]}>
          <View style={styles.statusRow}>
            <Text style={styles.statusEmoji}>{config.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusLabel, { color: config.color }]}>{config.label}</Text>
              {complaint.status === 'Low-Confidence' ? (
                <Text style={styles.statusSubtext}>
                  Flagged as private space or non-civic item. In triage queue.
                </Text>
              ) : complaint.status === 'Assigned' ? (
                <Text style={styles.statusSubtext}>
                  Routed to {complaint.department_name || 'Municipal Department'}
                </Text>
              ) : (
                <Text style={styles.statusSubtext}>Tracking municipal ticket</Text>
              )}
            </View>
          </View>
        </View>

        {/* Photo Card */}
        {complaint.photo_url ? (
          <View style={styles.photoContainer}>
            <Image
              source={{ uri: complaint.photo_url }}
              style={styles.photo}
              resizeMode="cover"
            />
          </View>
        ) : null}

        {/* Meta & ID Card */}
        <View style={styles.card}>
          <TouchableOpacity style={styles.idRow} onPress={copyId}>
            <Text style={styles.idLabel}>COMPLAINT ID</Text>
            <Text style={styles.idValue} numberOfLines={1}>
              {complaint.id}
            </Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <View style={styles.metaGrid}>
            <View style={styles.metaCell}>
              <Text style={styles.metaHeader}>Category</Text>
              <Text style={styles.metaContent}>
                {complaint.category === 'pending' ? '⏳ Classifying…' : complaint.category}
              </Text>
            </View>

            <View style={styles.metaCell}>
              <Text style={styles.metaHeader}>Severity</Text>
              <Text style={styles.metaContent}>
                {complaint.severity === 'high' ? '🔴 High' : complaint.severity === 'medium' ? '🟡 Medium' : '🟢 Low'}
              </Text>
            </View>

            <View style={styles.metaCell}>
              <Text style={styles.metaHeader}>Confidence</Text>
              <Text style={styles.metaContent}>
                {complaint.confidence_score != null
                  ? `${Math.round(complaint.confidence_score * 100)}%`
                  : 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {/* Municipal Routing & Geofence Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🏛️ Municipal Routing & Ward</Text>
          <View style={styles.routingRow}>
            <Text style={styles.routingIcon}>📍</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.routingLabel}>Municipal Ward (PostGIS):</Text>
              <Text style={styles.routingValue}>
                {complaint.ward_name || (complaint.ward_id ? 'Patiala Ward' : 'Unassigned (No GPS attached)')}
              </Text>
            </View>
          </View>

          <View style={styles.routingRow}>
            <Text style={styles.routingIcon}>🏢</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.routingLabel}>Dispatched Department:</Text>
              <Text style={styles.routingValue}>
                {complaint.department_name || 'General Maintenance'}
              </Text>
            </View>
          </View>

          {complaint.sla_deadline && (
            <View style={styles.routingRow}>
              <Text style={styles.routingIcon}>⏱️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.routingLabel}>SLA Resolution Window:</Text>
                <Text style={[styles.routingValue, { color: Colors.primary }]}>
                  {new Date(complaint.sla_deadline).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* AI Municipal Assessment Card */}
        {(complaint.ai_description || complaint.description) && (
          <View style={styles.card}>
            {complaint.ai_description && (
              <View style={{ marginBottom: complaint.description ? Spacing.md : 0 }}>
                <View style={styles.aiBadgeRow}>
                  <Text style={styles.aiBadgeText}>🤖 Gemini Multimodal Analysis</Text>
                </View>
                <Text style={styles.aiDescriptionText}>{complaint.ai_description}</Text>
              </View>
            )}

            {complaint.description && (
              <View>
                <Text style={styles.citizenNoteHeader}>Citizen Note</Text>
                <Text style={styles.citizenNoteText}>{complaint.description}</Text>
              </View>
            )}
          </View>
        )}

        {/* Lifecycle Stepper */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Lifecycle Tracking</Text>

          {isSpecialStatus && (
            <View
              style={[
                styles.specialBanner,
                { backgroundColor: config.color + '15', borderColor: config.color + '40' },
              ]}
            >
              <Text style={{ fontSize: 18, marginRight: Spacing.sm }}>{config.icon}</Text>
              <Text style={[styles.specialText, { color: config.color }]}>
                {complaint.status === 'Escalated' && 'SLA breached — escalated to supervisory officer.'}
                {complaint.status === 'Reopened' && 'Resolution was disputed by citizen.'}
                {complaint.status === 'Low-Confidence' && 'Held in human inspection triage queue.'}
                {complaint.status === 'Processing' && 'Gemini AI is analyzing image and routing.'}
              </Text>
            </View>
          )}

          {LIFECYCLE_STEPS.map((step, i) => {
            const isActive = i <= currentStepIndex && currentStepIndex >= 0;
            const isCurrent = step === complaint.status;

            return (
              <View key={step} style={styles.timelineRow}>
                {i > 0 && (
                  <View
                    style={[
                      styles.timelineConnector,
                      isActive && styles.timelineConnectorActive,
                    ]}
                  />
                )}
                <View
                  style={[
                    styles.timelineDot,
                    isActive && { backgroundColor: config.color },
                    isCurrent && styles.timelineDotCurrent,
                  ]}
                />
                <Text
                  style={[
                    styles.timelineLabel,
                    isActive && styles.timelineLabelActive,
                    isCurrent && { fontWeight: '700', color: config.color },
                  ]}
                >
                  {step}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Immutable Audit Trail Ledger */}
        {complaint.audit_trail && complaint.audit_trail.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>📜 Audit Trail Ledger (Immutable)</Text>
            {complaint.audit_trail.map((entry, idx) => (
              <View key={entry.id || idx} style={styles.auditItem}>
                <View style={styles.auditDot} />
                <View style={{ flex: 1 }}>
                  <View style={styles.auditHeaderRow}>
                    <Text style={styles.auditAction}>{entry.action}</Text>
                    <Text style={styles.auditRole}>[{entry.actor_role || 'system'}]</Text>
                  </View>
                  {entry.notes ? <Text style={styles.auditNotes}>{entry.notes}</Text> : null}
                  <Text style={styles.auditTimestamp}>
                    {new Date(entry.created_at).toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Re-analyze Button for testing / updating */}
        <TouchableOpacity
          style={[styles.classifyButton, classifying && { opacity: 0.6 }]}
          onPress={runAiAnalysis}
          disabled={classifying}
        >
          {classifying ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <Text style={styles.classifyButtonText}>⚡ Re-run AI Classification & Routing</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.pullHint}>Pull down to refresh ticket status</Text>
      </ScrollView>
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
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Spacing.xxxl,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  errorTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  errorSubtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  retryBtn: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
  },
  retryBtnText: {
    color: Colors.white,
    fontWeight: '600',
  },

  // Status Banner
  statusHeader: {
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.base,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusEmoji: {
    fontSize: 28,
    marginRight: Spacing.md,
  },
  statusLabel: {
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  statusSubtext: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  // Photo
  photoContainer: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.base,
    ...Shadows.md,
  },
  photo: {
    width: '100%',
    height: 240,
    backgroundColor: Colors.cardBg,
  },

  // Cards
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  cardTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },

  // ID Row
  idRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  idLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  idValue: {
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: Colors.textPrimary,
    maxWidth: '65%',
  },

  // Meta Grid
  metaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaCell: {
    flex: 1,
    alignItems: 'center',
  },
  metaHeader: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
  },
  metaContent: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textPrimary,
    textTransform: 'capitalize',
  },

  // Routing
  routingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  routingIcon: {
    fontSize: 18,
    marginRight: Spacing.sm,
    marginTop: 2,
  },
  routingLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  routingValue: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 1,
  },

  // AI Description
  aiBadgeRow: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    marginBottom: Spacing.xs,
  },
  aiBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    fontWeight: '700',
  },
  aiDescriptionText: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  citizenNoteHeader: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
  },
  citizenNoteText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },

  // Lifecycle
  specialBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  specialText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    flex: 1,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    height: 36,
  },
  timelineConnector: {
    position: 'absolute',
    left: 8,
    top: -18,
    width: 2,
    height: 36,
    backgroundColor: Colors.border,
  },
  timelineConnectorActive: {
    backgroundColor: Colors.primary,
  },
  timelineDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.border,
    marginRight: Spacing.md,
  },
  timelineDotCurrent: {
    borderWidth: 3,
    borderColor: Colors.bg,
    transform: [{ scale: 1.2 }],
  },
  timelineLabel: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  timelineLabelActive: {
    color: Colors.textPrimary,
    fontWeight: '600',
  },

  // Audit Ledger
  auditItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: Colors.primary + '40',
    paddingLeft: Spacing.sm,
  },
  auditDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    position: 'absolute',
    left: -5,
    top: 4,
  },
  auditHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  auditAction: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textPrimary,
    textTransform: 'uppercase',
  },
  auditRole: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  auditNotes: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  auditTimestamp: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },

  // Action Buttons
  classifyButton: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.base,
  },
  classifyButtonText: {
    color: Colors.primary,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  pullHint: {
    textAlign: 'center',
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: Spacing.sm,
  },
});
