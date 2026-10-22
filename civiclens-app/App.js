import React, { useState, useEffect, useCallback, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { supabase } from './src/lib/supabase';
import { Colors } from './src/constants/design';
import { View, ActivityIndicator, StyleSheet, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthContext } from './src/context/AuthContext';

// Main App Screens
import HomeScreen from './src/screens/HomeScreen';
import SubmitComplaintScreen from './src/screens/SubmitComplaintScreen';
import MyComplaintsScreen from './src/screens/MyComplaintsScreen';
import ComplaintDetailScreen from './src/screens/ComplaintDetailScreen';
import StatusScreen from './src/screens/StatusScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import NeighbourhoodScreen from './src/screens/NeighbourhoodScreen';

// Auth Screens
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// ---- Tab Icons (emoji-based, no extra deps) ----
function TabIcon({ emoji, focused, color }) {
  return (
    <Text style={{ fontSize: focused ? 24 : 21, opacity: focused ? 1 : 0.6 }}>
      {emoji}
    </Text>
  );
}

// ---- Bottom Tab Navigator ----
function MainTabs() {
  const insets = useSafeAreaInsets();
  
  // Base values for the tab bar
  const baseHeight = 60;
  const basePaddingBottom = 6;
  
  // Safe area padding for iPhones with home indicator / Androids with gesture bar
  const safeAreaBottom = insets.bottom > 0 ? insets.bottom : Platform.OS === 'android' ? 16 : 0;
  
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopWidth: 1,
          borderTopColor: Colors.border,
          height: baseHeight + safeAreaBottom,
          paddingBottom: basePaddingBottom + safeAreaBottom,
          paddingTop: 6,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="🏠" focused={focused} color={color} />,
        }}
      />
      <Tab.Screen
        name="MyComplaintsTab"
        component={MyComplaintsScreen}
        options={{
          tabBarLabel: 'My Reports',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="📋" focused={focused} color={color} />,
        }}
      />
      <Tab.Screen
        name="SubmitTab"
        component={SubmitComplaintScreen}
        options={{
          tabBarLabel: 'Report',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="📸" focused={focused} color={color} />,
        }}
      />
      <Tab.Screen
        name="NeighbourhoodTab"
        component={NeighbourhoodScreen}
        options={{
          tabBarLabel: 'Nearby',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="🏘️" focused={focused} color={color} />,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ focused, color }) => <TabIcon emoji="👤" focused={focused} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // splash/loading state

  // A ref that auth screens set to `true` when they are in the middle of a
  // multi-step flow (signup OTP, password reset). While true, the global
  // listener will NOT auto-navigate to Home even if a session appears.
  const suppressAutoNav = useRef(false);

  useEffect(() => {
    // 1. Check for an existing persisted session on cold start
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setIsAuthenticated(true);
      }
      setIsLoading(false);
    });

    // 2. Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth Event]', event, '| suppressAutoNav:', suppressAutoNav.current);

      if (event === 'SIGNED_OUT') {
        // Always respect sign-out
        setIsAuthenticated(false);
        return;
      }

      // If an auth screen has told us to suppress auto-navigation,
      // do NOT flip isAuthenticated. The screen will do it explicitly.
      if (suppressAutoNav.current) {
        return;
      }

      // For a normal password login (LoginScreen), navigate to Home
      if (event === 'SIGNED_IN' && session?.user) {
        setIsAuthenticated(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Exposed to auth screens via context
  const signOut = useCallback(async () => {
    suppressAutoNav.current = false;
    await supabase.auth.signOut();
    // The listener will set isAuthenticated = false
  }, []);

  const completeAuth = useCallback(() => {
    // Called by signup/forgot-password screens when ALL steps are done
    suppressAutoNav.current = false;
    setIsAuthenticated(true);
  }, []);

  const setSuppressAutoNav = useCallback((value) => {
    suppressAutoNav.current = value;
  }, []);

  // --- Loading splash ---
  if (isLoading) {
    return (
      <View style={loadingStyles.container}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const screenOptions = {
    headerStyle: { backgroundColor: Colors.white },
    headerTintColor: Colors.textPrimary,
    headerTitleStyle: { fontWeight: '700' },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: Colors.bg },
  };

  return (
    <AuthContext.Provider value={{ signOut, completeAuth, setSuppressAutoNav, isAuthenticated }}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={screenOptions}>
          {isAuthenticated ? (
            // Main App Flow — Tab Navigator + overlay screens
            <>
              <Stack.Screen
                name="MainTabs"
                component={MainTabs}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ComplaintDetail"
                component={ComplaintDetailScreen}
                options={{ title: 'Complaint Status' }}
              />
              <Stack.Screen
                name="Status"
                component={StatusScreen}
                options={{ title: 'Status' }}
              />
            </>
          ) : (
            // Auth Flow
            <>
              <Stack.Screen
                name="Login"
                component={LoginScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Signup"
                component={SignupScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ForgotPassword"
                component={ForgotPasswordScreen}
                options={{ headerShown: false }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </AuthContext.Provider>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.bg,
  },
});
