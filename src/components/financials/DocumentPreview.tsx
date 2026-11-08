/**
 * Shows a quote / change order / invoice exactly as the PDF is designed,
 * from the same HTML template (in its screen-sized "preview" layout).
 */

import React from 'react';
import { Platform, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

export function DocumentPreview({ html }: { html: string }) {
  const { colors } = useTheme();

  if (Platform.OS === 'web') {
    return (
      <View style={styles.fill}>
        {React.createElement('iframe', {
          srcDoc: html,
          title: 'Document preview',
          style: { border: 0, width: '100%', height: '100%', background: '#fff' },
        })}
      </View>
    );
  }

  return (
    <WebView
      style={[styles.fill, { backgroundColor: colors.background }]}
      originWhitelist={['about:*', 'data:*']}
      source={{ html }}
      // The document is static; links and navigation stay inside the app.
      onShouldStartLoadWithRequest={(req: { url: string }) => req.url === 'about:blank' || req.url.startsWith('data:')}
      javaScriptEnabled={false}
      startInLoadingState
      renderLoading={() => (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
      showsVerticalScrollIndicator={false}
      setBuiltInZoomControls
      setDisplayZoomControls={false}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
