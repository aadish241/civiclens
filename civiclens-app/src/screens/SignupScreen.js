import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, BackHandler } from 'react-native';
import { supabase } from '../lib/supabase';
import { Colors, Spacing, FontSize, Radius } from '../constants/design';
import { useAuth } from '../context/AuthContext';

export default function SignupScreen({ navigation }) {
  const { setSuppressAutoNav, completeAuth } = useAuth();
  const [step, setStep] = useState(1); // 1: Info, 2: OTP, 3: Password
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Tell the global listener to suppress auto-navigation while we're in
  // the multi-step signup flow. Release the lock when leaving the screen.
  useEffect(() => {
    setSuppressAutoNav(true);

    return () => {
      // When the component unmounts (user navigates away), release the lock.
      // If signup wasn't completed, also sign out any partially-created session
      // so stale sessions don't linger.
      setSuppressAutoNav(false);
    };
  }, [setSuppressAutoNav]);

  // Handle hardware back button: confirm before abandoning a mid-flow signup
  useEffect(() => {
    if (step === 1) return; // On step 1, normal back navigation is fine

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(
        'Cancel Signup?',
        'You haven\'t finished creating your account. Are you sure you want to go back?',
        [
          { text: 'Continue Signup', style: 'cancel' },
          {
            text: 'Go Back',
            style: 'destructive',
            onPress: async () => {
              // Sign out any partial session created by signUp()
              await supabase.auth.signOut();
              setSuppressAutoNav(false);
              navigation.goBack();
            },
          },
        ]
      );
      return true; // Prevent default back behavior
    });

    return () => backHandler.remove();
  }, [step, navigation, setSuppressAutoNav]);

  const handleSendOtp = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = displayName.trim();

    if (!trimmedEmail || !trimmedName) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      Alert.alert('Error', 'Please enter a valid email address.');
      return;
    }

    if (trimmedName.length < 2) {
      Alert.alert('Error', 'Name must be at least 2 characters long.');
      return;
    }

    setEmail(trimmedEmail);
    setDisplayName(trimmedName);
    setLoading(true);

    try {
      // Generate a temporary secure password to trigger the signup OTP flow
      const tempPassword = Math.random().toString(36).slice(-12) + 'A!1a';

      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password: tempPassword,
      });

      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          Alert.alert(
            'Account Already Exists',
            'This email is already registered. You can sign in or reset your password.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset Password', onPress: () => { setSuppressAutoNav(false); navigation.navigate('ForgotPassword'); } },
              { text: 'Go to Login', onPress: () => { setSuppressAutoNav(false); navigation.navigate('Login'); } },
            ]
          );
        } else {
          Alert.alert('Signup Failed', error.message);
        }
        return;
      }

      // Supabase may silently "succeed" for existing accounts but returns
      // a user with an empty identities array. Detect this case.
      if (data?.user?.identities && data.user.identities.length === 0) {
        // Account already exists — sign out the fake session
        await supabase.auth.signOut();
        Alert.alert(
          'Account Already Exists',
          'An account with this email already exists. Please sign in or reset your password.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reset Password', onPress: () => { setSuppressAutoNav(false); navigation.navigate('ForgotPassword'); } },
            { text: 'Go to Login', onPress: () => { setSuppressAutoNav(false); navigation.navigate('Login'); } },
          ]
        );
        return;
      }

      setStep(2);
    } catch (err) {
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
      console.error('Signup OTP error:', err);
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
      // 1. Verify the signup OTP — this creates a real session
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'signup',
      });

      if (verifyError) {
        Alert.alert(
          'Verification Failed',
          'Invalid or expired OTP. Please check and try again.'
        );
        setOtp('');
        return;
      }

      // Store the user ID for Step 3 profile creation
      if (verifyData?.user) {
        // We can temporarily store the user ID on the class/state if needed,
        // but session is active so supabase.auth.getUser() will work in step 3.
      }

      setStep(3);
    } catch (err) {
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
      console.error('Signup OTP verify error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePassword = async () => {
    if (!password) {
      Alert.alert('Error', 'Please enter a password.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);

    try {
      // 2. Update to their actual chosen password (session active from Step 2)
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        Alert.alert('Error', `Failed to set password: ${updateError.message}`);
        return;
      }

      // 3. Upsert the user profile in our `users` table
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        const { error: profileError } = await supabase.from('users').upsert({
          id: userData.user.id,
          display_name: displayName,
        });

        if (profileError) {
          console.error('Error creating profile:', profileError);
          // Non-fatal — continue
        }
      }

      // 4. All steps complete — NOW we can navigate to Home
      Alert.alert('Account Created', 'Your account has been set up successfully!', [
        {
          text: 'Continue',
          onPress: () => completeAuth(),
        }
      ]);
    } catch (err) {
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
      console.error('Signup finalize error:', err);
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
      'Cancel Signup?',
      'You haven\'t finished creating your account. Are you sure?',
      [
        { text: 'Continue Signup', style: 'cancel' },
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
      <Text style={styles.title}>Create Account</Text>
      
      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        {[1, 2, 3].map((s) => (
          <View key={s} style={styles.stepRow}>
            <View style={[styles.stepDot, step >= s && styles.stepDotActive]}>
              <Text style={[styles.stepDotText, step >= s && styles.stepDotTextActive]}>{s}</Text>
            </View>
            <Text style={[styles.stepLabel, step >= s && styles.stepLabelActive]}>
              {s === 1 ? 'Details' : s === 2 ? 'Verify' : 'Password'}
            </Text>
            {s < 3 && <View style={[styles.stepLine, step > s && styles.stepLineActive]} />}
          </View>
        ))}
      </View>
      
      {step === 1 && (
        <>
          <Text style={styles.subtitle}>Join CivicLens to report issues</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Full Name"
              value={displayName}
              onChangeText={setDisplayName}
              editable={!loading}
              returnKeyType="next"
            />
          </View>
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
          <Text style={styles.subtitle}>Create your password</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Password (min 6 characters)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
              returnKeyType="next"
            />
          </View>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={handleCreatePassword}
            />
          </View>
          <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleCreatePassword} disabled={loading}>
            {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.buttonText}>Complete Setup</Text>}
          </TouchableOpacity>
        </>
      )}

      {/* Back / Cancel link */}
      <View style={styles.linksContainer}>
        {step === 1 ? (
          <View style={styles.signupRow}>
            <Text style={styles.mutedText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => { setSuppressAutoNav(false); navigation.navigate('Login'); }}>
              <Text style={styles.linkText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel Signup</Text>
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
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  linkText: {
    color: Colors.primary,
    fontWeight: '600',
    fontSize: FontSize.base,
  },
  mutedText: {
    color: Colors.textSecondary,
    fontSize: FontSize.base,
  },
  cancelText: {
    color: Colors.error || '#ef4444',
    fontWeight: '600',
    fontSize: FontSize.base,
  },
});
