import React from 'react';
import { View, TextInput, Pressable, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing, sizing } from '@/theme/spacing';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  autoFocus?: boolean;
}

export function SearchBar({ value, onChangeText, placeholder = 'Search...', style, autoFocus }: SearchBarProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundTertiary, borderColor: colors.borderLight }, style]}>
      <Icon name="search" size={sizing.iconMd} color={colors.textTertiary} />
      <TextInput
        style={[styles.input, { color: colors.textPrimary }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        autoFocus={autoFocus}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear search">
          <Icon name="x" size={sizing.iconSm} color={colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    ...typeScale.bodySmall,
    height: '100%',
    padding: 0,
  },
});
