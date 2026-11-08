import React, { useRef, useEffect } from 'react';
import { ScrollView, Pressable, Text, View, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

interface SectionTab {
  key: string;
  label: string;
  icon?: string;
}

interface SectionTabsProps {
  tabs: SectionTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  style?: ViewStyle;
}

export function SectionTabs({ tabs, activeTab, onTabChange, style }: SectionTabsProps) {
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  return (
    <View style={[styles.wrapper, { borderBottomColor: colors.borderLight }, style]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[
                styles.tab,
                isActive && { borderBottomColor: colors.primary },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: isActive ? colors.primary : colors.textTertiary },
                  isActive && styles.tabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
  },
  tab: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginRight: spacing.xs,
  },
  tabText: {
    ...typeScale.labelSmall,
  },
  tabTextActive: {
    fontWeight: '600',
  },
});
