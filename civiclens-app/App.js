import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './src/screens/HomeScreen';
import SubmitComplaintScreen from './src/screens/SubmitComplaintScreen';
import MyComplaintsScreen from './src/screens/MyComplaintsScreen';
import ComplaintDetailScreen from './src/screens/ComplaintDetailScreen';
import StatusScreen from './src/screens/StatusScreen';
import { Colors } from './src/constants/design';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: Colors.white,
          },
          headerTintColor: Colors.textPrimary,
          headerTitleStyle: {
            fontWeight: '700',
          },
          headerShadowVisible: false,
          contentStyle: {
            backgroundColor: Colors.bg,
          },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: 'CivicLens', headerShown: false }}
        />
        <Stack.Screen
          name="Submit"
          component={SubmitComplaintScreen}
          options={{ title: 'Report an Issue' }}
        />
        <Stack.Screen
          name="MyComplaints"
          component={MyComplaintsScreen}
          options={{ title: 'My Complaints' }}
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}

