import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SubmitComplaintScreen from './src/screens/SubmitComplaintScreen';
import StatusScreen from './src/screens/StatusScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Submit">
        <Stack.Screen
          name="Submit"
          component={SubmitComplaintScreen}
          options={{ title: 'Report an issue' }}
        />
        <Stack.Screen
          name="Status"
          component={StatusScreen}
          options={{ title: 'Complaint status' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
