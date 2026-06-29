import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ListingsScreen from '../screens/ListingsScreen';

export type RootStackParamList = {
  Listings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Listings" component={ListingsScreen} options={{ title: 'PS5 Tracker' }} />
    </Stack.Navigator>
  );
}
