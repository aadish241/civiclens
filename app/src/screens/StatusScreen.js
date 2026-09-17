import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { supabase } from '../lib/supabase';

const STEPS = ['Submitted', 'Assigned', 'In Progress', 'Resolved', 'Closed'];

export default function StatusScreen({ route }) {
  const { complaintId } = route.params;
  const [complaint, setComplaint] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchComplaint = useCallback(async () => {
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .eq('id', complaintId)
      .single();
    if (!error) setComplaint(data);
    setLoading(false);
    setRefreshing(false);
  }, [complaintId]);

  useEffect(() => {
    fetchComplaint();
  }, [fetchComplaint]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchComplaint();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!complaint) {
    return (
      <View style={styles.center}>
        <Text>Complaint not found.</Text>
      </View>
    );
  }

  const currentStepIndex = STEPS.indexOf(complaint.status);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.idLabel}>Complaint ID</Text>
      <Text style={styles.id}>{complaint.id}</Text>

      {complaint.photo_url && (
        <Image source={{ uri: complaint.photo_url }} style={styles.photo} />
      )}

      {complaint.description ? (
        <Text style={styles.description}>{complaint.description}</Text>
      ) : null}

      <View style={styles.timeline}>
        {STEPS.map((step, i) => (
          <View key={step} style={styles.timelineRow}>
            <View style={[styles.dot, i <= currentStepIndex && styles.dotActive]} />
            <Text style={[styles.stepText, i <= currentStepIndex && styles.stepTextActive]}>
              {step}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.timestamp}>
        Submitted {new Date(complaint.created_at).toLocaleString()}
      </Text>
      <Text style={styles.hint}>Pull down to refresh status</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  idLabel: { fontSize: 12, color: '#888' },
  id: { fontSize: 14, fontFamily: 'monospace', marginBottom: 16 },
  photo: { width: '100%', height: 200, borderRadius: 12, marginBottom: 16 },
  description: { fontSize: 15, color: '#333', marginBottom: 24 },
  timeline: { marginBottom: 24 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ddd', marginRight: 12 },
  dotActive: { backgroundColor: '#2563eb' },
  stepText: { fontSize: 15, color: '#aaa' },
  stepTextActive: { color: '#111', fontWeight: '600' },
  timestamp: { fontSize: 12, color: '#888' },
  hint: { fontSize: 12, color: '#bbb', marginTop: 8 },
});
