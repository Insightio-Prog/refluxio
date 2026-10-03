import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type BottomSafeAreaShieldProps = {
  /** Fill colour for the home-indicator band (default matches diary cards). */
  backgroundColor?: string;
};

/** Bottom safe-area shield — matches Diary / test-scan. */
export function BottomSafeAreaShield({ backgroundColor = '#fff' }: BottomSafeAreaShieldProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.bottomShield, { height: insets.bottom + 24, backgroundColor }]}
      pointerEvents="none"
    >
      <View style={styles.bottomShieldShadow} />
    </View>
  );
}

const styles = StyleSheet.create({
  bottomShield: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -22,
    backgroundColor: '#fff',
    zIndex: 100,
    elevation: 10,
  },
  bottomShieldShadow: {
    position: 'absolute',
    top: -3,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(15, 23, 42, 0.03)',
  },
});
