import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { submitComplaintToBackend } from '../lib/api';
import { Colors, Shadows, Radius, FontSize, Spacing } from '../constants/design';

// Default Patiala / Thapar University Campus coordinates for testing
const THAPAR_COORDS = {
  latitude: 30.3560,
  longitude: 76.3570,
  label: 'Thapar Campus (Ward W-01)',
};

export default function SubmitComplaintScreen({ navigation }) {
  const [photo, setPhoto] = useState(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // GPS Location state
  const [location, setLocation] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationText, setLocationText] = useState('Detecting GPS...');
  const [useThaparFallback, setUseThaparFallback] = useState(false);

  useEffect(() => {
    fetchLocation();
  }, []);

  const fetchLocation = async () => {
    setLocationLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationText('GPS permission denied (Using Thapar coordinates)');
        setLocation(THAPAR_COORDS);
        setUseThaparFallback(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        label: `${position.coords.latitude.toFixed(4)}° N, ${position.coords.longitude.toFixed(4)}° E`,
      };
      setLocation(coords);
      setLocationText(`GPS: ${coords.label}`);
    } catch (err) {
      console.warn('GPS detection failed, applying Thapar coordinates:', err);
      setLocationText('GPS unavailable (Using Thapar Campus W-01)');
      setLocation(THAPAR_COORDS);
      setUseThaparFallback(true);
    } finally {
      setLocationLoading(false);
    }
  };

  const toggleThaparCoordinates = () => {
    if (!useThaparFallback) {
      setUseThaparFallback(true);
      setLocation(THAPAR_COORDS);
      setLocationText('Thapar Campus (Ward W-01) selected');
    } else {
      setUseThaparFallback(false);
      fetchLocation();
    }
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Camera permission is required to report an issue.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      base64: false,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0]);
      // Refresh GPS when snapping photo
      if (!useThaparFallback) {
        fetchLocation();
      }
    }
  };

  const submitComplaint = async () => {
    if (!photo) {
      Alert.alert('Photo required', 'Please take a photo of the issue first.');
      return;
    }

    const lat = location?.latitude ?? THAPAR_COORDS.latitude;
    const lng = location?.longitude ?? THAPAR_COORDS.longitude;

    setSubmitting(true);
    try {
      // Direct high-speed upload to Supabase cloud storage (< 1s)
      const base64 = await FileSystem.readAsStringAsync(photo.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const fileName = `complaint-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('complaint-photos')
        .upload(fileName, decode(base64), { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('complaint-photos')
        .getPublicUrl(fileName);

      // Insert complaint record directly into Supabase
      const { data: dbData, error: insertError } = await supabase
        .from('complaints')
        .insert({
          description: description?.trim() || null,
          category: 'pending',
          status: 'Submitted',
          photo_url: publicUrlData.publicUrl,
          latitude: lat,
          longitude: lng,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      const complaintId = dbData.id;

      // Insert initial audit trail log
      try {
        await supabase.table('audit_logs').insert({
          complaint_id: complaintId,
          action: 'complaint_submitted',
          new_value: 'Submitted',
          actor_role: 'citizen',
          notes: 'Complaint submitted by citizen via mobile app.',
        });
      } catch (auditErr) {
        console.warn('Initial audit log notice:', auditErr);
      }

      // Transition immediately to status screen (under 1.5s total)
      navigation.navigate('ComplaintDetail', { complaintId });
      setPhoto(null);
      setDescription('');
    } catch (err) {
      console.error(err);
      Alert.alert('Submission Error', err.message ?? 'Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Step 1: Photo */}
          <View style={styles.section}>
            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepNumber}>1</Text>
              </View>
              <Text style={styles.stepLabel}>Take a photo of the issue</Text>
            </View>

            {photo ? (
              <View style={styles.previewWrapper}>
                <Image source={{ uri: photo.uri }} style={styles.preview} />
                <TouchableOpacity style={styles.retakeButton} onPress={takePhoto}>
                  <Text style={styles.retakeText}>📷 Retake</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.captureButton}
                activeOpacity={0.75}
                onPress={takePhoto}
              >
                <Text style={styles.captureIcon}>📷</Text>
                <Text style={styles.captureTitle}>Open Camera</Text>
                <Text style={styles.captureSubtitle}>
                  Live capture only — anti-tamper direct observation
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Step 2: Location Verification */}
          <View style={styles.section}>
            <View style={styles.stepRow}>
              <View style={[styles.stepBadge, !photo && styles.stepBadgeInactive]}>
                <Text style={[styles.stepNumber, !photo && styles.stepNumberInactive]}>2</Text>
              </View>
              <Text style={[styles.stepLabel, !photo && styles.stepLabelInactive]}>
                Location & Ward Geofence
              </Text>
            </View>

            <View style={styles.locationCard}>
              <View style={styles.locationHeaderRow}>
                <Text style={styles.locationPinIcon}>📍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.locationTitle}>
                    {locationLoading ? 'Detecting coordinates...' : locationText}
                  </Text>
                  <Text style={styles.locationCoords}>
                    Lat: {location?.latitude?.toFixed(4) ?? '30.3560'}° • Lng: {location?.longitude?.toFixed(4) ?? '76.3570'}°
                  </Text>
                </View>
                {locationLoading && <ActivityIndicator size="small" color={Colors.primary} />}
              </View>

              <View style={styles.locationActionsRow}>
                <TouchableOpacity
                  style={[styles.locationChip, useThaparFallback && styles.locationChipActive]}
                  onPress={toggleThaparCoordinates}
                >
                  <Text style={[styles.locationChipText, useThaparFallback && styles.locationChipTextActive]}>
                    🏛️ Thapar Campus W-01
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.locationChip}
                  onPress={fetchLocation}
                  disabled={locationLoading}
                >
                  <Text style={styles.locationChipText}>🔄 Refresh GPS</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Step 3: Note */}
          <View style={styles.section}>
            <View style={styles.stepRow}>
              <View style={[styles.stepBadge, !photo && styles.stepBadgeInactive]}>
                <Text style={[styles.stepNumber, !photo && styles.stepNumberInactive]}>3</Text>
              </View>
              <Text style={[styles.stepLabel, !photo && styles.stepLabelInactive]}>
                Add a note (optional)
              </Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Describe what you see — e.g. 'Broken road near Gate 1, major hazard for two-wheelers'"
              placeholderTextColor={Colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              editable={!!photo}
            />
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!photo || submitting) && styles.submitDisabled,
            ]}
            onPress={submitComplaint}
            disabled={!photo || submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <>
                <Text style={styles.submitText}>Submit Complaint</Text>
                <Text style={styles.submitHint}>
                  Fast submission & automated AI classification
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  stepBadgeInactive: {
    backgroundColor: Colors.border,
  },
  stepNumber: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: FontSize.sm,
  },
  stepNumberInactive: {
    color: Colors.textMuted,
  },
  stepLabel: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  stepLabelInactive: {
    color: Colors.textMuted,
  },

  // Photo Box
  captureButton: {
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    padding: Spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureIcon: {
    fontSize: 42,
    marginBottom: Spacing.sm,
  },
  captureTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: Spacing.xs,
  },
  captureSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  previewWrapper: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.cardBg,
    ...Shadows.md,
  },
  preview: {
    width: '100%',
    height: 260,
    resizeMode: 'cover',
  },
  retakeButton: {
    position: 'absolute',
    bottom: Spacing.md,
    right: Spacing.md,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  retakeText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: FontSize.sm,
  },

  // Location Card
  locationCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  locationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  locationPinIcon: {
    fontSize: 22,
    marginRight: Spacing.sm,
  },
  locationTitle: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  locationCoords: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 2,
  },
  locationActionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  locationChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  locationChipActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary,
  },
  locationChipText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  locationChipTextActive: {
    color: Colors.primary,
  },

  // Input
  input: {
    backgroundColor: Colors.cardBg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    minHeight: 90,
    textAlignVertical: 'top',
  },

  // Submit Button
  submitButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.md,
    marginTop: Spacing.sm,
  },
  submitDisabled: {
    opacity: 0.45,
  },
  submitText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  submitHint: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: FontSize.xs,
    marginTop: 2,
  },
});
