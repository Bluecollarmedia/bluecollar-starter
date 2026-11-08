/**
 * A bottom sheet for clearing an activity log: pick what to do (move to history / restore / delete for good), pick the period
 * (today, yesterday, older than 30 days, a whole year, all time), see the real count and confirm. Used by the Snow Activity
 * screen and by a project's Activity Log. Nothing changes until the final button.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import {
  MODE_HELP, MODE_LABEL, clearConfirmation, scopeChoices, scopeLabel, scopeRange,
  type ClearMode, type ClearRange, type ClearScope,
} from '@/lib/logClear';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** What the entries are called in the question: "log" or "activity". */
  what?: string;
  modes: ClearMode[];
  years: number[];
  preview: (range: ClearRange, mode: ClearMode) => Promise<Result<number>>;
  run: (range: ClearRange, mode: ClearMode) => Promise<Result<number>>;
  /** Called after a change, with a short message to show. */
  onDone: (message: string) => void;
}

export function ClearLogSheet({ visible, onClose, title, what = 'log', modes, years, preview, run, onDone }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<ClearMode>(modes[0]);
  const [pending, setPending] = useState<{ scope: ClearScope; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setMode(modes[0]); setPending(null); setBusy(false); setMessage(null); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const scopes = useMemo(() => scopeChoices(years), [years]);
  const confirmation = pending ? clearConfirmation(pending.scope, mode, pending.count, what) : null;

  async function pick(scope: ClearScope) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await preview(scopeRange(scope), mode);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setPending({ scope, count: res.data });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const res = await run(scopeRange(pending.scope), mode);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const done = mode === 'archive' ? 'moved to history' : mode === 'restore' ? 'restored' : 'deleted';
    onDone(`${res.data} ${res.data === 1 ? 'entry' : 'entries'} ${done}.`);
    onClose();
  }

  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, { backgroundColor: colors.borderLight }]} />
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{title}</Text>

          {confirmation && 'title' in confirmation ? (
            <View style={{ marginTop: spacing.md, gap: spacing.md }}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{confirmation.title}</Text>
              <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{confirmation.message}</Text>
              {error ? <Text style={[typeScale.caption, { color: colors.error }]}>{error}</Text> : null}
              <Button
                title={confirmation.confirm}
                variant={mode === 'delete' ? 'danger' : 'primary'}
                loading={busy}
                onPress={confirm}
                fullWidth
                size="lg"
              />
              <Button title="Back" variant="ghost" onPress={() => { setPending(null); setError(null); }} disabled={busy} fullWidth />
            </View>
          ) : (
            <>
              {modes.length > 1 ? (
                <View style={styles.modes}>
                  {modes.map((m) => {
                    const on = m === mode;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => { setMode(m); setPending(null); setMessage(null); setError(null); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={[styles.modeChip, { backgroundColor: on ? (m === 'delete' ? colors.error : colors.primary) : colors.backgroundTertiary }]}
                      >
                        <Text style={[typeScale.labelLarge, { color: on ? '#FFFFFF' : colors.textPrimary }]}>{MODE_LABEL[m]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>{MODE_HELP[mode]}</Text>
              {confirmation && 'nothing' in confirmation ? (
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>{confirmation.nothing}</Text>
              ) : null}
              {error ? <Text style={[typeScale.caption, { color: colors.error, marginTop: spacing.sm }]}>{error}</Text> : null}
              <Text style={[typeScale.overline, { color: colors.textTertiary, marginTop: spacing.lg, marginBottom: spacing.xs }]}>WHICH PERIOD?</Text>
              <ScrollView bounces={false} style={{ maxHeight: 340 }}>
                {scopes.map((s, i) => (
                  <Pressable
                    key={scopeLabel(s)}
                    onPress={() => pick(s)}
                    disabled={busy}
                    accessibilityRole="button"
                    style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }, busy && { opacity: 0.5 }]}
                  >
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{scopeLabel(s)}</Text>
                    <Icon name="chevron-right" size={18} color={colors.textTertiary} />
                  </Pressable>
                ))}
              </ScrollView>
              <Button title="Cancel" variant="ghost" onPress={onClose} fullWidth style={{ marginTop: spacing.sm }} />
            </>
          )}
        </Pressable>
      </Pressable>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  modes: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  modeChip: { paddingHorizontal: spacing.md, minHeight: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
});
