/**
 * Where the customer signs with a finger or mouse on the approval web page. Draws into a box, reports the signature as
 * plain path text (see src/lib/signature.ts) and has a Clear button. The approval page is opened in a browser, so this uses the
 * browser's own drawing (SVG and pointer events); outside a browser it shows a short note instead.
 */
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { SIG_HEIGHT, SIG_WIDTH, fitSignature, hasSigned, strokesToPath, type Point } from '@/lib/signature';

interface Props {
  /** Called with the finished path, or '' when cleared / not enough drawn yet. */
  onChange: (path: string) => void;
}

export function SignaturePad({ onChange }: Props) {
  const t = useT();
  const { colors } = useTheme();
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const strokesRef = useRef<Point[][]>([]);
  const drawing = useRef(false);

  const commit = useCallback((next: Point[][]) => {
    strokesRef.current = next;
    setStrokes(next);
    onChange(hasSigned(next) ? fitSignature(next) : '');
  }, [onChange]);

  if (Platform.OS !== 'web') {
    return <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{t('Open the approval link in a web browser to sign.')}</Text>;
  }

  const toPoint = (e: { clientX: number; clientY: number; currentTarget: Element }): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIG_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * SIG_HEIGHT;
    return { x: Math.min(SIG_WIDTH, Math.max(0, x)), y: Math.min(SIG_HEIGHT, Math.max(0, y)) };
  };

  const svg = React.createElement(
    'svg',
    {
      viewBox: `0 0 ${SIG_WIDTH} ${SIG_HEIGHT}`,
      width: '100%',
      height: '100%',
      role: 'img',
      'aria-label': t('Signature area: draw your signature here'),
      style: { touchAction: 'none', cursor: 'crosshair', display: 'block' },
      onPointerDown: (e: any) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drawing.current = true;
        strokesRef.current = [...strokesRef.current, [toPoint(e)]];
        setStrokes(strokesRef.current);
      },
      onPointerMove: (e: any) => {
        if (!drawing.current) return;
        const all = strokesRef.current.slice();
        const last = all[all.length - 1];
        if (!last) return;
        all[all.length - 1] = [...last, toPoint(e)];
        strokesRef.current = all;
        setStrokes(all);
      },
      onPointerUp: () => { if (!drawing.current) return; drawing.current = false; commit(strokesRef.current); },
      onPointerCancel: () => { if (!drawing.current) return; drawing.current = false; commit(strokesRef.current); },
    },
    React.createElement('line', { x1: 12, y1: SIG_HEIGHT - 28, x2: SIG_WIDTH - 12, y2: SIG_HEIGHT - 28, stroke: colors.border, strokeWidth: 1, strokeDasharray: '4 4' }),
    React.createElement('path', { d: strokesToPath(strokes), fill: 'none', stroke: colors.textPrimary, strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  );

  const empty = strokes.length === 0;
  return (
    <View>
      <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}>
        {svg}
        {empty && <Text pointerEvents="none" style={[typeScale.bodySmall, styles.hint, { color: colors.textTertiary }]}>{t('Sign here with your finger or mouse')}</Text>}
      </View>
      <Pressable onPress={() => commit([])} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Clear signature')} style={styles.clear}>
        <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('Clear')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 132, borderWidth: 1.5, borderRadius: radius.lg, overflow: 'hidden' },
  hint: { position: 'absolute', left: 0, right: 0, top: 44, textAlign: 'center' },
  clear: { alignSelf: 'flex-end', paddingVertical: spacing.xs },
});
