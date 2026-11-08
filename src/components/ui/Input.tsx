/**
 * Input — Text Input Component
 *
 * Clean, accessible text input with label, error state,
 * and optional icon. Designed to feel native on each platform.
 */

import React, { forwardRef, useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TextInputProps,
  Pressable,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing, sizing } from '@/theme/spacing';

interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: keyof typeof Feather.glyphMap;
  containerStyle?: ViewStyle;
}

export const Input = forwardRef<TextInput, InputProps>(
  ({ label, error, hint, icon, containerStyle, secureTextEntry, ...props }, ref) => {
    const { colors } = useTheme();
    const [focused, setFocused] = useState(false);
    const [secureVisible, setSecureVisible] = useState(false);

    const isPassword = secureTextEntry !== undefined;
    const borderColor = error
      ? '#C62828'
      : focused
        ? colors.borderFocus
        : colors.border;

    return (
      <View style={[styles.container, containerStyle]}>
        {label && (
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {label}
          </Text>
        )}
        <View
          style={[
            styles.inputRow,
            {
              borderColor,
              backgroundColor: focused ? colors.surface : colors.backgroundSecondary,
            },
          ]}
        >
          {icon && (
            <Icon
              name={icon}
              size={sizing.iconMd}
              color={focused ? colors.primary : colors.textTertiary}
              style={styles.icon}
            />
          )}
          <TextInput
            ref={ref}
            style={[
              styles.input,
              { color: colors.textPrimary },
              icon ? { paddingLeft: 0 } : {},
            ]}
            placeholderTextColor={colors.textTertiary}
            onFocus={(e) => {
              setFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              props.onBlur?.(e);
            }}
            secureTextEntry={isPassword && !secureVisible}
            accessibilityLabel={label}
            {...props}
          />
          {isPassword && (
            <Pressable
              onPress={() => setSecureVisible(!secureVisible)}
              hitSlop={8}
              accessibilityLabel={secureVisible ? 'Hide password' : 'Show password'}
            >
              <Icon
                name={secureVisible ? 'eye-off' : 'eye'}
                size={sizing.iconMd}
                color={colors.textTertiary}
              />
            </Pressable>
          )}
        </View>
        {(error || hint) && (
          <Text
            style={[
              styles.helper,
              { color: error ? '#C62828' : colors.textTertiary },
            ]}
          >
            {error || hint}
          </Text>
        )}
      </View>
    );
  },
);

Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    ...typeScale.labelSmall,
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: sizing.inputHeight,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  icon: {
    marginRight: spacing.xs,
  },
  input: {
    flex: 1,
    ...typeScale.bodyLarge,
    height: '100%',
    padding: 0,
  },
  helper: {
    ...typeScale.caption,
    marginTop: spacing.xs,
  },
});
