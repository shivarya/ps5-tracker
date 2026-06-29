import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import RootNavigator from './src/navigation/RootNavigator';
import { registerForPushNotificationsAsync } from './src/services/pushRegistration';

function AppContent() {
  const { isDark, colors } = useTheme();
  const navTheme = isDark ? DarkTheme : DefaultTheme;

  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  return (
    <NavigationContainer
      theme={{
        ...navTheme,
        colors: { ...navTheme.colors, background: colors.background, primary: colors.primary },
      }}
    >
      <RootNavigator />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
