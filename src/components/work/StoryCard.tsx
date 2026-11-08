import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { OptimizedImage } from '@/components/ui';
import { normalizeDesign, type StoryDesign } from '@/lib/portfolioStories';

/**
 * The background of a shared story: a plain colour, a two-colour gradient, or the picture itself blurred. Drawn behind the framed card.
 */
export function StoryBackdrop({ design, coverUrl }: { design: StoryDesign; coverUrl: string | null }) {
  if (design.background === 'blur' && coverUrl) {
    return (
      <View style={StyleSheet.absoluteFill}>
        <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} blurRadius={28} resizeMode="cover" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,16,12,0.35)' }]} />
      </View>
    );
  }
  if (design.background === 'solid') return <View style={[StyleSheet.absoluteFill, { backgroundColor: design.color }]} />;
  return <LinearGradient colors={[design.color, design.color2]} style={StyleSheet.absoluteFill} />;
}

/**
 * The framed card of a shared story: the post's cover inside a border the owner designed (colour, thickness, roundness, size), with an optional
 * line of text above or below. It is DRAWN from the design each time it is shown (never saved as one flat picture), which is what keeps it
 * editable and lets a tap on it open the post. `onLongPress` / `onPress` are given by the viewer; the owner's live preview passes none.
 */
export function StoryCard({ design: rawDesign, coverUrl, isVideo, width, children }: {
  design: Partial<StoryDesign> | null | undefined;
  coverUrl: string | null;
  isVideo: boolean;
  /** The width of the screen (or preview) the card sits in. */
  width: number;
  children?: React.ReactNode;
}) {
  const design = normalizeDesign(rawDesign);
  const cardW = Math.round(width * design.scale);
  const cardH = Math.round(cardW * 1.25);
  const inner = Math.max(0, design.radius - design.frameWidth);
  return (
    <View style={{ alignItems: 'center' }}>
      {design.text && design.textPlace === 'top' ? <Text style={[styles.text, { color: design.textColor, marginBottom: 16, width: cardW }]}>{design.text}</Text> : null}
      <View style={{ width: cardW, height: cardH, borderRadius: design.radius, borderWidth: design.frameWidth, borderColor: design.frameColor, overflow: 'hidden', backgroundColor: '#1B2740', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}>
        {coverUrl ? <OptimizedImage source={coverUrl} style={{ width: '100%', height: '100%', borderRadius: inner }} contentFit="cover" /> : null}
        {isVideo ? (
          <View style={styles.playWrap} pointerEvents="none"><View style={styles.playDot}><MaterialCommunityIcons name="play" size={34} color="#FFFFFF" /></View></View>
        ) : null}
        {children}
      </View>
      {design.text && design.textPlace === 'bottom' ? <Text style={[styles.text, { color: design.textColor, marginTop: 16, width: cardW }]}>{design.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 20, fontWeight: '700', textAlign: 'center', lineHeight: 26 },
  playWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  playDot: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(8,16,12,0.5)', alignItems: 'center', justifyContent: 'center' },
});
