import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, BackHandler } from 'react-native';
import { supabase } from '../lib/supabase';
import { Colors, Spacing, FontSize, Radius } from '../constants/design';
import { useAuth } from '../context/AuthContext';

export default function ForgotPasswordScreen({ navigation }) {
  const { setSuppressAutoNav, completeAuth } = useAuth();
  const [step, setStep] = useState(1); // 1: Email, 2: OTP, 3: New Password
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Suppress global auto-navigation while in multi-step flow
  useEffect(() => {
    setSuppressAutoNav(true);

    return () => {
      setSuppressAutoNav(false);
    };
  }, [setSuppressAutoNav]);

  // Hardware back button: confirm before abandoning mid-flow
  useEffect(() => {
    if (step === 1) return;

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(
        'Cancel Password Reset?',
        'You haven\'t finished resetting your password. Are you sure you want to go back?',
        [
          { text: 'Continue', style: 'cancel' },
          {
            text: 'Go Back',
            style: 'destructive',
            onPress: async () => {
              await supabase.auth.signOut();
              setSuppressAutoNav(false);
              navigation.goBack();
            },
          },
        ]
      );
      return true;
    });

    return () => backHandler.remove();
  }, [step, navigation, setSuppressAutoNav]);

  const handleSendOtp = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail) {
      Alert.alert('Error', 'Please enter your email address.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      Alert.alert('Error', 'Please enter a valid email address.');
      return;
    }

    setEmail(trimmedEmail);
    setLoading(true);

    try {
      // Note: resetPasswordForEmail uses the "Reset Password" template in Supabase.
      // That template MUST contain {{ .Token }} for the OTP to appear in the email.
      const { data, error } = await supabase.auth.resetPasswordForEmail(trimmedEmail);

      console.log('[Forgot Password] resetPasswordForEmail response:', { data, error });

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        // Supabase won't tell us if the account doesn't exist (security feature).
        // So we always show success and move to OTP step.
        Alert.alert(
          'Check Your Email',
          `If an account exists for ${trimmedEmail}, an 8-digit reset code has been sent. Check your inbox and spam folder.`,
          [{ text: 'OK' }]
        );
        setStep(2);
      }
    } catch (err) {
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
      console.error('Reset password OTP error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length < 6) {
      Alert.alert('Error', 'Please enter the complete OTP from your email.');
      return;
    }

    setLoading(true);
    try {
      // 1. Verify the recovery OTP — this creates a session
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'recovery',
      });

      if (verifyError) {
        Alert.alert('Verification Failed', 'Invalid or expired OTP. Please check and try again.');
        setOtp('');
        return;
      }

      setStep(3);
    } catch (err) {
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword) {
      Alert.alert('Error', 'Please enter a new password.');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);

    try {
      // 2. Update the password (session was already created in Step 2)
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        Alert.alert('Error', `Failed to update password: ${updateError.message}`);
        return;
      }

      // 3. All done — let the user choose what to do
      Alert.alert(
        'Password Reset Successful',
        'Your password has been updated. You are now signed in.',
        [
          {
            text: 'Continue to Home',
            onPress: () => completeAuth(),
          },
        ]
      );
    } catch (err) {
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
      console.error('Reset password finalize error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (step === 1) {
      setSuppressAutoNav(false);
      navigation.goBack();
      return;
    }

    Alert.alert(
      'Cancel Password Reset?',
      'You haven\'t finished resetting your password. Are you sure?',
      [
        { text: 'Continue', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            setSuppressAutoNav(false);
            navigation.goBack();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reset Password</Text>
      
      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        {[1, 2, 3].map((s) => (
          <View key={s} style={styles.stepRow}>
            <View style={[styles.stepDot, step >= s && styles.stepDotActive]}>
              <Text style={[styles.stepDotText, step >= s && styles.stepDotTextActive]}>{s}</Text>
            </View>
            <Text style={[styles.stepLabel, step >= s && styles.stepLabelActive]}>
              {s === 1 ? 'Email' : s === 2 ? 'Verify' : 'Password'}
            </Text>
            {s < 3 && <View style={[styles.stepLine, step > s && styles.stepLineActive]} />}
          </View>
        ))}
      </View>
      
      {step === 1 && (
        <>
          <Text style={styles.subtitle}>Enter your email to receive a reset code</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Email Address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={handleSendOtp}
            />
          </View>
          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSendOtp} disabled={loading}>
            {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.buttonText}>Send OTP</Text>}
          </TouchableOpacity>
        </>
      )}

      {step === 2 && (
        <>
          <Text style={styles.subtitle}>Enter the OTP sent to {email}</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Enter 8-digit OTP"
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={8}
            />
          </View>
          <TouchableOpacity style={styles.button} onPress={handleVerifyOtp}>
            <Text style={styles.buttonText}>Verify OTP</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resendButton} onPress={handleSendOtp} disabled={loading}>
            <Text style={styles.resendText}>Didn't receive it? Resend OTP</Text>
          </TouchableOpacity>
        </>
      )}

      {step === 3 && (
        <>
          <Text style={styles.subtitle}>Create your new password</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="New Password (min 6 characters)"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              editable={!loading}
              returnKeyType="next"
            />
          </View>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Confirm New Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={handleResetPassword}
            />
          </View>
          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleResetPassword} disabled={loading}>
            {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.buttonText}>Confirm Reset</Text>}
          </TouchableOpacity>
        </>
      )}

      {/* Back / Cancel */}
      <View style={styles.linksContainer}>
        {step === 1 ? (
          <TouchableOpacity onPress={() => { setSuppressAutoNav(false); navigation.goBack(); }}>
            <Text style={styles.linkText}>Back to Login</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel Reset</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    padding: Spacing.xl,
    justifyContent: 'center',
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    marginBottom: Spacing.xl,
  },
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDotActive: {
    backgroundColor: Colors.primary,
  },
  stepDotText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
  },
  stepDotTextActive: {
    color: Colors.white,
  },
  stepLabel: {
    fontSize: 11,
    color: '#94a3b8',
    marginLeft: 4,
    fontWeight: '500',
  },
  stepLabelActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  stepLine: {
    width: 24,
    height: 2,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 6,
  },
  stepLineActive: {
    backgroundColor: Colors.primary,
  },
  inputContainer: {
    marginBottom: Spacing.md,
  },
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },
  button: {
    backgroundColor: Colors.primary,
    padding: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: Colors.white,
    fontSize: FontSize.base,
    fontWeight: '600',
  },
  resendButton: {
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  resendText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textDecorationLine: 'underline',
  },
  linksContainer: {
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  linkText: {
    color: Colors.primary,
    fontWeight: '600',
    fontSize: FontSize.base,
  },
  cancelText: {
    color: Colors.error || '#ef4444',
    fontWeight: '600',
    fontSize: FontSize.base,
  },
});
