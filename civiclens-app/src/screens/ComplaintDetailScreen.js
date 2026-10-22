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
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import {
  fetchComplaintDetail,
  triggerAiClassification,
  confirmComplaintResolution,
  disputeComplaintResolution,
  resolveComplaintByOfficial,
} from '../lib/api';
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
  Resolved: { color: '#059669', icon: '✅', label: 'Resolved (Pending Verification)' },
  Closed: { color: '#64748B', icon: '🔒', label: 'Closed & Confirmed' },
  Reopened: { color: '#DC2626', icon: '🔄', label: 'Reopened by Citizen' },
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

  // Resolution & Dispute states (Step 2)
  const [confirming, setConfirming] = useState(false);
  const [disputeModalVisible, setDisputeModalVisible] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputePhoto, setDisputePhoto] = useState(null);
  const [disputing, setDisputing] = useState(false);
  const [resolvingDev, setResolvingDev] = useState(false);

  const fetchComplaint = useCallback(async () => {
    try {
      // 1. Try backend API first for rich joined data + real immutable audit trail
      try {
        const detail = await fetchComplaintDetail(complaintId);
        if (detail && detail.id) {
          setComplaint(detail);
          return;
        }
      } catch (_) {
        // Fallback to Supabase direct query below
      }

      // 2. Fallback: Fetch directly from Supabase
      const { data, error } = await supabase
        .from('complaints')
        .select('*')
        .eq('id', complaintId)
        .single();

      if (error) throw error;
      if (data) {
        const wardName = data.ward_id
          ? KNOWN_WARDS[data.ward_id] || 'W-01 — Thapar / Bhadson Road'
          : null;
        const deptName = data.department_id
          ? KNOWN_DEPARTMENTS[data.department_id] || 'General Maintenance'
          : null;

        // Build fallback audit trail
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

        if (data.status === 'Resolved' || data.resolved_at) {
          logs.push({
            id: 'log-3',
            action: 'official_resolved',
            new_value: 'Resolved',
            actor_role: 'official',
            notes: data.resolution_notes || 'Municipal official completed repair work.',
            created_at: data.resolved_at || data.updated_at,
          });
        }

        if (data.status === 'Closed' || data.closed_at) {
          logs.push({
            id: 'log-4',
            action: 'citizen_confirmed',
            new_value: 'Closed',
            actor_role: 'citizen',
            notes: 'Citizen confirmed resolution. Ticket closed.',
            created_at: data.closed_at || data.updated_at,
          });
        }

        if (data.status === 'Reopened') {
          logs.push({
            id: 'log-5',
            action: 'citizen_disputed',
            new_value: 'Reopened',
            actor_role: 'citizen',
            notes: 'Resolution disputed by citizen.',
            created_at: data.updated_at,
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
      console.warn('Error fetching complaint:', err.message);
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
      await supabase
        .from('complaints')
        .update({ status: 'Submitted', category: 'pending' })
        .eq('id', complaintId);

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

  // Step 2: Citizen Confirmation
  const handleConfirmResolution = () => {
    Alert.alert(
      'Confirm Issue Resolution',
      'Are you satisfied that the municipal department has resolved this issue? This will permanently close the ticket.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Close Ticket',
          style: 'default',
          onPress: async () => {
            setConfirming(true);
            try {
              await confirmComplaintResolution(complaintId);
              Alert.alert('Resolution Confirmed! 🎉', 'Thank you for verifying and holding municipal authorities accountable.');
              await fetchComplaint();
            } catch (err) {
              Alert.alert('Error', err.message || 'Failed to confirm resolution.');
            } finally {
              setConfirming(false);
            }
          },
        },
      ]
    );
  };

  // Step 2: Snap Dispute Photo
  const handleCaptureDisputePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Camera access is required to take proof photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.7,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setDisputePhoto(result.assets[0]);
      }
    } catch (e) {
      console.warn('Error launching camera:', e);
    }
  };

  // Step 2: Citizen Dispute Submission
  const handleSubmitDispute = async () => {
    if (!disputeReason.trim()) {
      Alert.alert('Reason Required', 'Please provide a brief reason explaining why the resolution is unsatisfactory.');
      return;
    }
    setDisputing(true);
    try {
      await disputeComplaintResolution(complaintId, {
        reason: disputeReason.trim(),
        photoUri: disputePhoto?.uri,
      });
      setDisputeModalVisible(false);
      setDisputeReason('');
      setDisputePhoto(null);
      Alert.alert(
        'Dispute Submitted 🔄',
        'Your dispute has been logged. The complaint is now Reopened and returned to the department supervisor for remedial inspection.'
      );
      await fetchComplaint();
    } catch (err) {
      Alert.alert('Dispute Failed', err.message || 'Could not submit dispute.');
    } finally {
      setDisputing(false);
    }
  };

  // Dev / Testing Helper: Simulate Official Resolution
  const handleDevSimulateResolve = () => {
    Alert.alert(
      '🛠️ Simulate Official Resolution',
      'Mark this ticket as Resolved with official notes and proof to test the Citizen Confirm / Dispute loop?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Resolved',
          onPress: async () => {
            setResolvingDev(true);
            try {
              await resolveComplaintByOfficial(complaintId, {
                resolutionNotes: 'Field crew dispatched: Pothole filled with cold-mix asphalt, leveled, and compacted. Site cleared for traffic.',
              });
              Alert.alert('Simulated Resolution', 'Complaint status is now "Resolved". You can now test Confirm or Dispute!');
              await fetchComplaint();
            } catch (err) {
              Alert.alert('Error', err.message || 'Failed to simulate resolution.');
            } finally {
              setResolvingDev(false);
            }
          },
        },
      ]
    );
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
              ) : complaint.status === 'Resolved' ? (
                <Text style={styles.statusSubtext}>
                  Official submitted resolution proof. Awaiting your verification.
                </Text>
              ) : (
                <Text style={styles.statusSubtext}>Tracking municipal ticket</Text>
              )}
            </View>
          </View>
        </View>

        {/* Step 2: Official Resolution Proof Card (shows when resolved, closed, or reopened) */}
        {(complaint.resolution_notes || complaint.resolution_photo_url || complaint.status === 'Resolved') && (
          <View style={[styles.card, styles.resolutionCard]}>
            <View style={styles.resolutionHeaderRow}>
              <Text style={styles.resolutionCardTitle}>🛠️ Official Resolution Report</Text>
              <View
                style={[
                  styles.resolutionBadge,
                  complaint.status === 'Resolved' && { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
                  complaint.status === 'Closed' && { backgroundColor: '#F1F5F9', borderColor: '#64748B' },
                  complaint.status === 'Reopened' && { backgroundColor: '#FEF2F2', borderColor: '#EF4444' },
                ]}
              >
                <Text
                  style={[
                    styles.resolutionBadgeText,
                    complaint.status === 'Resolved' && { color: '#059669' },
                    complaint.status === 'Closed' && { color: '#475569' },
                    complaint.status === 'Reopened' && { color: '#DC2626' },
                  ]}
                >
                  {complaint.status === 'Resolved' ? 'Pending Citizen Verification' : complaint.status}
                </Text>
              </View>
            </View>

            {complaint.resolution_photo_url && (
              <View style={styles.resolutionPhotoContainer}>
                <Image
                  source={{ uri: complaint.resolution_photo_url }}
                  style={styles.resolutionPhoto}
                  resizeMode="cover"
                />
                <View style={styles.resolutionPhotoBadge}>
                  <Text style={styles.resolutionPhotoBadgeText}>📸 Official Proof Photo</Text>
                </View>
              </View>
            )}

            {complaint.resolution_notes && (
              <View style={styles.resolutionNotesBox}>
                <Text style={styles.resolutionNotesLabel}>Official Remarks:</Text>
                <Text style={styles.resolutionNotesText}>{complaint.resolution_notes}</Text>
              </View>
            )}

            {complaint.resolved_at && (
              <Text style={styles.resolutionTimestamp}>
                Completed: {new Date(complaint.resolved_at).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </View>
        )}

        {/* Step 2: Citizen Verification Box (Active ONLY when Resolved) */}
        {complaint.status === 'Resolved' && (
          <View style={styles.actionCard}>
            <View style={styles.actionPromptHeader}>
              <Text style={{ fontSize: 26, marginRight: Spacing.sm }}>⚖️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionPromptTitle}>Citizen Verification Required</Text>
                <Text style={styles.actionPromptSubtitle}>
                  Municipal officials reported this issue as resolved. Please inspect the site and confirm or dispute below:
                </Text>
              </View>
            </View>

            <View style={styles.actionButtonsRow}>
              {/* Confirm Resolution Button */}
              <TouchableOpacity
                style={[styles.confirmBtn, confirming && { opacity: 0.6 }]}
                onPress={handleConfirmResolution}
                disabled={confirming}
              >
                {confirming ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <>
                    <Text style={styles.confirmBtnIcon}>✅</Text>
                    <Text style={styles.confirmBtnText}>Confirm Resolution</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Dispute Resolution Button */}
              <TouchableOpacity
                style={styles.disputeBtn}
                onPress={() => setDisputeModalVisible(true)}
              >
                <Text style={styles.disputeBtnIcon}>❌</Text>
                <Text style={styles.disputeBtnText}>Dispute Work</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.autoCloseHint}>
              ⏱️ SLA Policy: If no citizen action is taken within 7 days, this ticket auto-closes (FR-C7).
            </Text>
          </View>
        )}

        {/* Closed Banner */}
        {complaint.status === 'Closed' && (
          <View style={styles.closedBanner}>
            <Text style={{ fontSize: 22, marginRight: Spacing.sm }}>🎉</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.closedBannerTitle}>Ticket Closed & Confirmed</Text>
              <Text style={styles.closedBannerSub}>
                Citizen verified resolution. This municipal ticket is officially completed and archived.
              </Text>
            </View>
          </View>
        )}

        {/* Reopened Banner */}
        {complaint.status === 'Reopened' && (
          <View style={styles.reopenedBanner}>
            <Text style={{ fontSize: 22, marginRight: Spacing.sm }}>🔄</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.reopenedBannerTitle}>Resolution Disputed — Ticket Reopened</Text>
              <Text style={styles.reopenedBannerSub}>
                Returned to the municipal supervisor for remedial inspection and rework.
              </Text>
            </View>
          </View>
        )}

        {/* Complaint Photo Card */}
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

        {/* Dev / Test Helper: Simulate Official Resolution */}
        {['Assigned', 'In Progress', 'Escalated'].includes(complaint.status) && (
          <TouchableOpacity
            style={[styles.devResolveBtn, resolvingDev && { opacity: 0.6 }]}
            onPress={handleDevSimulateResolve}
            disabled={resolvingDev}
          >
            {resolvingDev ? (
              <ActivityIndicator color={Colors.primary} size="small" />
            ) : (
              <Text style={styles.devResolveBtnText}>
                🛠️ [Test Step 2] Simulate Official Marking as Resolved
              </Text>
            )}
          </TouchableOpacity>
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

      {/* Step 2: Dispute Resolution Modal */}
      <Modal
        visible={disputeModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setDisputeModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Dispute Issue Resolution</Text>
              <TouchableOpacity onPress={() => setDisputeModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              Explain why this civic work is incomplete or unsatisfactory. Your complaint will be reopened and escalated back to the municipal supervisor.
            </Text>

            <TextInput
              style={styles.disputeInput}
              placeholder="e.g. The pothole was only partially filled with loose gravel and washed away with recent rain..."
              placeholderTextColor={Colors.textMuted}
              value={disputeReason}
              onChangeText={setDisputeReason}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            {/* Optional Proof Photo */}
            {disputePhoto ? (
              <View style={styles.disputePhotoPreviewContainer}>
                <Image source={{ uri: disputePhoto.uri }} style={styles.disputePhotoPreview} />
                <TouchableOpacity
                  style={styles.removePhotoBtn}
                  onPress={() => setDisputePhoto(null)}
                >
                  <Text style={styles.removePhotoText}>Remove Photo ✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.attachPhotoBtn}
                onPress={handleCaptureDisputePhoto}
              >
                <Text style={styles.attachPhotoBtnText}>📷 Snap Proof Photo (Optional)</Text>
              </TouchableOpacity>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setDisputeModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalSubmitBtn,
                  (!disputeReason.trim() || disputing) && { opacity: 0.5 },
                ]}
                onPress={handleSubmitDispute}
                disabled={!disputeReason.trim() || disputing}
              >
                {disputing ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Submit Dispute</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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

  // Resolution Card
  resolutionCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
    backgroundColor: '#F0FDF4',
  },
  resolutionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  resolutionCardTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: '#065F46',
  },
  resolutionBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  resolutionBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  resolutionPhotoContainer: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: Spacing.sm,
  },
  resolutionPhoto: {
    width: '100%',
    height: 180,
    backgroundColor: Colors.cardBg,
  },
  resolutionPhotoBadge: {
    position: 'absolute',
    bottom: Spacing.sm,
    left: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  resolutionPhotoBadgeText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '600',
  },
  resolutionNotesBox: {
    backgroundColor: Colors.white,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  resolutionNotesLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: '#047857',
    marginBottom: 2,
  },
  resolutionNotesText: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  resolutionTimestamp: {
    fontSize: FontSize.xs,
    color: '#059669',
    textAlign: 'right',
  },

  // Citizen Action Card
  actionCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.base,
    borderWidth: 2,
    borderColor: '#10B981',
    ...Shadows.md,
  },
  actionPromptHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.base,
  },
  actionPromptTitle: {
    fontSize: FontSize.base,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  actionPromptSubtitle: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  confirmBtn: {
    flex: 1.2,
    backgroundColor: '#059669',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.sm,
  },
  confirmBtnIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  confirmBtnText: {
    color: Colors.white,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  disputeBtn: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderColor: '#DC2626',
    borderWidth: 1.5,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disputeBtnIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  disputeBtnText: {
    color: '#DC2626',
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  autoCloseHint: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },

  // Banners for Closed & Reopened
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderColor: '#94A3B8',
    borderWidth: 1,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.base,
  },
  closedBannerTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: '#334155',
  },
  closedBannerSub: {
    fontSize: FontSize.xs,
    color: '#64748B',
    marginTop: 2,
  },
  reopenedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.base,
  },
  reopenedBannerTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: '#991B1B',
  },
  reopenedBannerSub: {
    fontSize: FontSize.xs,
    color: '#B91C1C',
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

  // Dev simulation button
  devResolveBtn: {
    backgroundColor: '#F3E8FF',
    borderColor: '#A855F7',
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.base,
  },
  devResolveBtnText: {
    color: '#7E22CE',
    fontSize: FontSize.sm,
    fontWeight: '700',
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

  // Dispute Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: Colors.cardBg,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.xl,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalCloseText: {
    fontSize: 20,
    color: Colors.textMuted,
    padding: Spacing.xs,
  },
  modalSub: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.base,
  },
  disputeInput: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    minHeight: 100,
    marginBottom: Spacing.base,
  },
  attachPhotoBtn: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  attachPhotoBtnText: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    fontWeight: '600',
  },
  disputePhotoPreviewContainer: {
    marginBottom: Spacing.lg,
    alignItems: 'center',
  },
  disputePhotoPreview: {
    width: '100%',
    height: 140,
    borderRadius: Radius.md,
    backgroundColor: Colors.bg,
  },
  removePhotoBtn: {
    marginTop: Spacing.xs,
  },
  removePhotoText: {
    fontSize: FontSize.xs,
    color: '#DC2626',
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  modalSubmitBtn: {
    flex: 1.5,
    backgroundColor: '#DC2626',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitBtnText: {
    fontSize: FontSize.sm,
    color: Colors.white,
    fontWeight: '700',
  },
});
