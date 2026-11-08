/**
 * Button — Primary UI Component
 *
 * Variants:
 *  - primary:   Solid brand-green background, white text
 *  - secondary: Outlined with brand-green border and text
 *  - ghost:     No border, brand-green text (for inline actions)
 *  - danger:    Solid red background (for destructive actions)
 *
 * Sizes: sm | md | lg
 */

import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing, sizing } from '@/theme/spacing';
import { semantic } from '@/theme/colors';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Feather.glyphMap;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const sizeConfig = {
    sm: { height: sizing.buttonHeightSm, px: spacing.md, text: typeScale.labelSmall, iconSize: sizing.iconSm },
    md: { height: sizing.buttonHeight, px: spacing.xl, text: typeScale.labelLarge, iconSize: sizing.iconMd },
    lg: { height: sizing.buttonHeightLg, px: spacing['2xl'], text: typeScale.labelLarge, iconSize: sizing.iconLg },
  }[size];

  function getStyles(pressed: boolean) {
    const base: ViewStyle = {
      height: sizeConfig.height,
      paddingHorizontal: sizeConfig.px,
      borderRadius: radius.full,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      opacity: isDisabled ? 0.5 : 1,
      // Slight press-down so taps feel physical.
      transform: [{ scale: pressed && !isDisabled ? 0.97 : 1 }],
    };

    if (fullWidth) base.width = '100%';

    let bg: string;
    let textColor: string;
    let borderColor: string | undefined;

    switch (variant) {
      case 'primary':
        bg = pressed ? colors.primaryDark : colors.primary;
        textColor = colors.textOnPrimary;
        break;
      case 'secondary':
        bg = pressed ? colors.border : colors.primarySurface;
        textColor = colors.primary;
        break;
      case 'ghost':
        bg = pressed ? colors.primarySurface : 'transparent';
        textColor = colors.primary;
        break;
      case 'danger':
        bg = pressed ? '#B71C1C' : semantic.error;
        textColor = '#FFFFFF';
        break;
      default:
        bg = colors.primary;
        textColor = colors.textOnPrimary;
    }

    const container: ViewStyle = {
      ...base,
      backgroundColor: bg,
      ...(borderColor ? { borderWidth: 1.5, borderColor } : {}),
    };

    const text: TextStyle = {
      ...sizeConfig.text,
      color: textColor,
    };

    return { container, text, textColor };
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [getStyles(pressed).container, style]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled }}
    >
      {({ pressed }) => {
        const styles = getStyles(pressed);
        return (
          <>
            {loading ? (
              <ActivityIndicator size="small" color={styles.textColor} />
            ) : (
              <>
                {icon && iconPosition === 'left' && (
                  <Icon name={icon} size={sizeConfig.iconSize} color={styles.textColor} />
                )}
                <Text style={styles.text}>{title}</Text>
                {icon && iconPosition === 'right' && (
                  <Icon name={icon} size={sizeConfig.iconSize} color={styles.textColor} />
                )}
              </>
            )}
          </>
        );
      }}
    </Pressable>
  );
}
