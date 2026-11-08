/**
 * Owner and admin: manage Our Work. The master switch (only the owner can flip it; it starts OFF, so you can add everything first), the text under
 * the name, links to the story and the Highlights, and every post with its own show/hide switch and an Edit button. New post and New reel start here.
 */
import React, { useCallback, useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, GlassIconButton, Icon, InlineNotice, Input, LoadingSpinner, OptimizedImage } from '@/components/ui';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { ProfileAvatar } from '@/components/work/ProfileAvatar';
import { uploadPortfolioPhoto } from '@/data/portfolioUpload';
import { keepPicked } from '@/lib/keepPickedFile';
import { loadOwnerPortfolio, saveProfile, setPostVisible, type OwnerPortfolio, type OwnerPost } from '@/data/portfolioOwner';
import { setPortfolioEnabled } from '@/data/portfolio';
import { db } from '@/data/store';
import { formatDuration, postGridUrl } from '@/lib/portfolio';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const countsLabel = (p: OwnerPost): string => {
  const photos = p.media.filter((m) => m.kind === 'photo').length;
  const videos = p.media.filter((m) => m.kind === 'video').length;
  return [photos ? `${photos} photo${photos === 1 ? '' : 's'}` : '', videos ? `${videos} video${videos === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ') || 'Empty';
};

/** `base` is the owner area this screen sits in: '/(owner)' or '/snow/owner'. */
export function OurWorkManagerScreen({ base }: { base: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isOwner = db.role === 'owner';
  const [data, setData] = useState<OwnerPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (first = false) => {
    const r = await loadOwnerPortfolio();
    setLoading(false);
    if (!r.ok) { setProblem(r.error); return; }
    setProblem(null);
    setData(r.data);
    if (first) { setBio(r.data.settings.bio); setWebsite(r.data.settings.website); setAvatar(r.data.settings.avatar_url ?? null); }
  }, []);
  useEffect(() => { void reload(true); }, [reload]);

  function flip(next: boolean) {
    if (!isOwner || busy) return;
    const change = async () => {
      setBusy(true);
      const r = await setPortfolioEnabled(next);
      setBusy(false);
      if (!r.ok) { showMessage("Couldn't change Our Work", r.error); return; }
      await reload();
    };
    if (next) {
      confirmAction('Show Our Work?', 'The Our Work tab appears in the app for everyone who is not signed in, with every post you have switched on.', 'Show it', change);
    } else {
      confirmAction('Hide Our Work?', 'The Our Work tab disappears from the app. Your posts are kept; turn it back on any time.', 'Hide it', change);
    }
  }

  async function saveText() {
    setBusy(true);
    const r = await saveProfile({ bio, website });
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    setProblem(null);
    setSavedNote('Saved.');
    setTimeout(() => setSavedNote(null), 2500);
  }

  /** Choose the profile picture: pick a photo and crop it square (the phone's own crop), then it is saved and shown at once. */
  async function changePicture() {
    setProblem(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setProblem('Turn on photo access for Brighton Lawn in the Settings app.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (result.canceled || !result.assets[0] || !db.companyId) return;
    setBusy(true);
    try {
      const kept = await keepPicked(result.assets[0].uri, 'image');
      const up = await uploadPortfolioPhoto(kept, db.companyId, 'covers');
      const r = await saveProfile({ bio, website, avatarUrl: up.thumbUrl });
      if (!r.ok) { setProblem(r.error); return; }
      setAvatar(up.thumbUrl);
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : "Couldn't upload that picture.");
    } finally {
      setBusy(false);
    }
  }

  async function useLeafLogo() {
    setBusy(true);
    const r = await saveProfile({ bio, website, avatarUrl: null });
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    setAvatar(null);
  }

  async function toggleVisible(p: OwnerPost, visible: boolean) {
    setData((d) => (d ? { ...d, posts: d.posts.map((x) => (x.id === p.id ? { ...x, visible } : x)) } : d));
    const r = await setPostVisible(p.id, visible);
    if (!r.ok) { setProblem(r.error); await reload(); }
  }

  const open = (pathname: string, params?: Record<string, string>) => router.push({ pathname: `${base}/${pathname}`, params } as any);
  const on = data?.settings.enabled ?? false;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      >
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>Our Work</Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg }]}>
          Show off your projects like a photo feed. Add everything first, then switch it on.
        </Text>
        {problem ? <InlineNotice icon="alert-circle" tone="error" text={problem} style={{ marginBottom: spacing.md }} /> : null}

        {loading ? <LoadingSpinner /> : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Show Our Work in the app</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
                  {isOwner ? (on ? 'On: visitors see the Our Work tab.' : 'Off: nothing is public until you turn it on.') : `Only the owner can turn this on or off. It is ${on ? 'on' : 'off'} now.`}
                </Text>
              </View>
              <Switch value={on} onValueChange={flip} disabled={!isOwner || busy} accessibilityLabel="Show Our Work in the app" trackColor={{ true: '#2E5E34' }} />
            </View>

            <Text style={[typeScale.labelSmall, styles.heading, { color: colors.textTertiary }]}>ABOUT US</Text>
            <View style={[styles.cardCol, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <ProfileAvatar uri={avatar} size={64} />
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Profile picture</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button title="Change picture" size="sm" variant="secondary" onPress={changePicture} loading={busy} />
                    {avatar ? <Button title="Use the leaf" size="sm" variant="secondary" onPress={useLeafLogo} disabled={busy} /> : null}
                  </View>
                </View>
              </View>
              <Input label="Bio" value={bio} onChangeText={setBio} multiline maxLength={300} placeholder="Landscape construction and commercial maintenance across New Jersey." />
              <Input label="Website" value={website} onChangeText={setWebsite} maxLength={120} autoCapitalize="none" placeholder="brightonlawn.com" />
              <Button title={savedNote ?? 'Save'} size="sm" onPress={saveText} loading={busy} />
            </View>

            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <LinkRow icon="circle" title="Story" subtitle="Add to your story or share a post to it" onPress={() => open('our-work-stories')} />
              <LinkRow icon="disc" title="Highlights" subtitle="The circles at the top: Patios, Turf, Lighting…" onPress={() => open('our-work-highlights')} />
            </View>

            <View style={styles.postsHead}>
              <Text style={[typeScale.labelSmall, { color: colors.textTertiary }]}>YOUR POSTS</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title="+ New post" size="sm" onPress={() => open('our-work-post', { mode: 'post' })} />
                <Button title="+ New reel" size="sm" variant="secondary" onPress={() => open('our-work-post', { mode: 'reel' })} />
              </View>
            </View>

            {data && data.posts.length === 0 ? (
              <EmptyState icon="image" title="No posts yet" description="Add a post with photos and videos, or a reel (one video). Old work counts too." />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {(data?.posts ?? []).map((p) => {
                  const uri = postGridUrl(p);
                  const reel = p.kind === 'video';
                  const len = p.media.find((m) => m.kind === 'video')?.duration_s;
                  return (
                    <View key={p.id} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <View style={[styles.thumb, { backgroundColor: colors.backgroundTertiary }]}>
                        {uri ? <OptimizedImage source={uri} style={styles.thumb} /> : null}
                        {reel ? <View style={styles.playBadge}><Icon name="play" size={14} color="#FFFFFF" /></View> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>{p.caption || p.town || (reel ? 'Reel' : 'Project')}</Text>
                        <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{reel ? `Reel${len ? ` · ${formatDuration(len)}` : ''}` : countsLabel(p)}{p.town ? ` · ${p.town}` : ''}</Text>
                      </View>
                      <Pressable onPress={() => open('our-work-post', { id: p.id })} accessibilityRole="button" accessibilityLabel={`Edit ${p.caption || 'post'}`} style={styles.edit}><Text style={[typeScale.labelLarge, { color: colors.primary, fontWeight: '700' }]}>Edit</Text></Pressable>
                      <Switch value={p.visible} onValueChange={(v) => toggleVisible(p, v)} accessibilityLabel={p.visible ? 'Shown. Turn off to hide' : 'Hidden. Turn on to show'} trackColor={{ true: '#2E5E34' }} />
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function LinkRow({ icon, title, subtitle, onPress }: { icon: string; title: string; subtitle: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.85 }]}>
      <Icon name={icon as any} size={22} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{title}</Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  cardCol: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  heading: { marginTop: spacing.xl, marginBottom: spacing.sm },
  postsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: 56, height: 56, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playBadge: { position: 'absolute', right: 4, bottom: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(8,16,12,0.6)', alignItems: 'center', justifyContent: 'center' },
  edit: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
