import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

export default function SubmitComplaintScreen({ navigation }) {
  const [photo, setPhoto] = useState(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission is required to report an issue.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      base64: false,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0]);
    }
  };

  const submitComplaint = async () => {
    if (!photo) {
      Alert.alert('Please take a photo of the issue first.');
      return;
    }
    setSubmitting(true);
    try {
      // 1. Upload photo to Supabase Storage
      const response = await fetch(photo.uri);
      const blob = await response.blob();
      const fileName = `complaint-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('complaint-photos')
        .upload(fileName, blob, { contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('complaint-photos')
        .getPublicUrl(fileName);

      // 2. Insert complaint row.
      // NOTE: category is hardcoded to 'general' for the week-1 skeleton —
      // the AI classification worker replaces this in week 3.
      const { data, error: insertError } = await supabase
        .from('complaints')
        .insert({
          description,
          category: 'general',
          status: 'Submitted',
          photo_url: publicUrlData.publicUrl,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      navigation.navigate('Status', { complaintId: data.id });
      setPhoto(null);
      setDescription('');
    } catch (err) {
      console.error(err);
      Alert.alert('Something went wrong', err.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Report an issue</Text>

      {photo ? (
        <Image source={{ uri: photo.uri }} style={styles.preview} />
      ) : (
        <TouchableOpacity style={styles.photoButton} onPress={takePhoto}>
          <Text style={styles.photoButtonText}>📷 Take a photo</Text>
        </TouchableOpacity>
      )}

      {photo && (
        <TouchableOpacity onPress={takePhoto}>
          <Text style={styles.retake}>Retake photo</Text>
        </TouchableOpacity>
      )}

      <TextInput
        style={styles.input}
        placeholder="Add a short note (optional)"
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.disabled]}
        onPress={submitComplaint}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>Submit complaint</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  photoButton: {
    height: 200,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ccc',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  photoButtonText: { fontSize: 16, color: '#555' },
  preview: { width: '100%', height: 200, borderRadius: 12, marginBottom: 10 },
  retake: { color: '#2563eb', textAlign: 'center', marginBottom: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: 10,
    marginBottom: 20,
  },
  submitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  disabled: { opacity: 0.6 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
