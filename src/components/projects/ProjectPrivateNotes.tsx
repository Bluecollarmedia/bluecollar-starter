/**
 * "My Notes" for a project, owner only: private notes (what to order, measurements, what material to use), the owner's own pictures
 * of the site, and a materials list sorted out of the notes to print for a vendor. It belongs to the project, so what is
 * written while quoting is still here once the quote is approved. Shown inside the quote editor and in the project's More menu.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Platform, TextInput, Modal, ScrollView, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, OptimizedImage } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import {
  addOwnerNote, addOwnerPhoto, deleteMaterialList, deleteOwnerNote, organizeMaterials, removeOwnerPhoto, updateOwnerNote, updateOwnerPhotoCaption,
  useOwnerMaterialLists, useOwnerNotes, useOwnerPhotos, useIsProjectOwner,
} from '@/data/ownerProjectNotes';
import { pickImage } from '@/lib/pickImage';
import { printHtml } from '@/lib/printHtml';
import { groupByCategory, materialListHtml, quantityText, storedToList, type MaterialList } from '@/lib/materialList';
import { NOTE_MAX } from '@/lib/truckDocs';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { OwnerProjectPhoto } from '@/types/project';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function confirm(title: string, message: string, action: string, run: () => void) {
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: run }]);
}

interface Props {
  projectId: string;
  projectName: string;
  address?: string;
  /** The project's own internal notes (the Overview's Internal Notes). Shown here too so all of the owner's notes are in one place. */
  internalNotes?: string;
  onEditInternalNotes?: () => void;
}

export function ProjectPrivateNotes({ projectId, projectName, address, internalNotes, onEditInternalNotes }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const isOwner = useIsProjectOwner();
  const notes = useOwnerNotes(projectId);
  const photos = useOwnerPhotos(projectId);
  const lists = useOwnerMaterialLists(projectId);

  const [draft, setDraft] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<OwnerProjectPhoto | null>(null);
  const [caption, setCaption] = useState('');
  const [sorting, setSorting] = useState(false);
  const [sortError, setSortError] = useState<string | null>(null);
  const [shown, setShown] = useState<MaterialList | null>(null);

  if (!isOwner) return null;

  function saveNote() {
    const r = addOwnerNote(projectId, draft);
    if (!r.ok) { setNoteError(r.error); return; }
    setDraft('');
    setNoteError(null);
    Keyboard.dismiss();
  }

  async function takePicture(source: 'camera' | 'library') {
    setPhotoError(null);
    const res = await pickImage(source, { afterSheetMs: 0 });
    if (res.status === 'error') { setPhotoError(res.message); return; }
    if (res.status !== 'picked') return;
    setUploading(true);
    const r = await addOwnerPhoto(projectId, res.uri);
    setUploading(false);
    if (!r.ok) setPhotoError(r.error);
  }

  function addPicture() {
    if (Platform.OS === 'web') { takePicture('library'); return; }
    Alert.alert('Add a picture', undefined, [
      { text: 'Take Photo', onPress: () => setTimeout(() => takePicture('camera'), 450) },
      { text: 'Choose from Library', onPress: () => setTimeout(() => takePicture('library'), 450) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function sort() {
    setSorting(true);
    setSortError(null);
    const r = await organizeMaterials(projectId, projectName);
    setSorting(false);
    if (r.ok) setShown(r.list); else setSortError(r.error);
  }

  async function print(list: MaterialList) {
    try {
      await printHtml(
        materialListHtml({ list, projectName, address, company: db.company?.name ?? 'Brighton Lawn + Landscape', dateText: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }),
        list.title,
      );
    } catch (e) {
      Alert.alert("Couldn't make the PDF", e instanceof Error ? e.message : 'Please try again.');
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.privateTag}>
        <Icon name="lock" size={13} color={colors.textTertiary} />
        <Text style={[typeScale.caption, { color: colors.textTertiary, flex: 1 }]}>
          Only you can see My Notes. Not your workers, admins or the customer. They stay with this project after the quote is approved.
        </Text>
      </View>

      {internalNotes?.trim() ? (
        <Card title="Project Notes (Overview)" style={{ marginTop: 0 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{internalNotes}</Text>
          {onEditInternalNotes ? (
            <Pressable onPress={onEditInternalNotes} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button">
              <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Edit on the Overview</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      <Card title="My Notes" style={{ marginTop: 0 }}>
        <TextInput
          value={draft}
          onChangeText={(t) => { setDraft(t.slice(0, NOTE_MAX)); setNoteError(null); }}
          placeholder="What to order, measurements, what material to use…"
          placeholderTextColor={colors.textTertiary}
          multiline
          style={[typeScale.bodyLarge, styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
          accessibilityLabel="Add a note for yourself"
        />
        {noteError ? <Text style={[typeScale.caption, { color: colors.error }]}>{noteError}</Text> : null}
        <Button title="Add Note" icon="plus" variant="secondary" onPress={saveNote} disabled={!draft.trim()} fullWidth />
        {notes.map((n, i) => (
          <View key={n.id} style={[styles.noteRow, { borderTopColor: colors.border }, i === 0 && { marginTop: spacing.md }]}>
            {editing === n.id ? (
              <View style={{ flex: 1, gap: spacing.sm }}>
                <TextInput value={editText} onChangeText={(t) => setEditText(t.slice(0, NOTE_MAX))} multiline autoFocus style={[typeScale.bodyLarge, styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]} />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button title="Cancel" variant="ghost" onPress={() => setEditing(null)} style={{ flex: 1 }} />
                  <Button title="Save" onPress={() => { const r = updateOwnerNote(n.id, editText); if (r.ok) { Keyboard.dismiss(); setEditing(null); } else setNoteError(r.error); }} style={{ flex: 1 }} />
                </View>
              </View>
            ) : (
              <>
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{n.body}</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{when(n.createdAt)}</Text>
                </View>
                <Pressable onPress={() => { setEditing(n.id); setEditText(n.body); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit this note"><Icon name="edit-2" size={16} color={colors.textTertiary} /></Pressable>
                <Pressable onPress={() => confirm('Delete this note?', 'It will be removed for good.', 'Delete', () => deleteOwnerNote(n.id))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Delete this note"><Icon name="trash-2" size={16} color={colors.textTertiary} /></Pressable>
              </>
            )}
          </View>
        ))}
      </Card>

      <Card title="Materials List" style={{ marginTop: 0 }}>
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
          Sorts everything you wrote into a clean list by category, with quantities only where your notes gave them. Print it or share it as a PDF for a vendor.
        </Text>
        {sortError ? <Text style={[typeScale.bodySmall, { color: colors.error, marginBottom: spacing.sm }]}>{sortError}</Text> : null}
        <Button title={sorting ? 'Sorting your notes…' : 'Sort Notes into a Materials List'} icon="list" onPress={sort} loading={sorting} disabled={sorting || notes.length === 0} fullWidth />
        {notes.length === 0 ? <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>Add a note first.</Text> : null}
        {lists.map((l) => (
          <View key={l.id} style={[styles.listRow, { borderTopColor: colors.border }]}>
            <Pressable onPress={() => setShown(storedToList(l))} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={`Open ${l.title}`}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{l.title}</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{l.items.length} {l.items.length === 1 ? 'line' : 'lines'} · {when(l.createdAt)}</Text>
            </Pressable>
            <Pressable onPress={() => confirm('Delete this list?', 'Your notes are not affected.', 'Delete', () => deleteMaterialList(l.id))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Delete this list"><Icon name="trash-2" size={16} color={colors.textTertiary} /></Pressable>
          </View>
        ))}
      </Card>

      <Card title="My Pictures" style={{ marginTop: 0 }}>
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
          Your own pictures of the site, from before anything starts. Customers never see these.
        </Text>
        {photoError ? <Text style={[typeScale.bodySmall, { color: colors.error, marginBottom: spacing.sm }]}>{photoError}</Text> : null}
        <View style={styles.grid}>
          {photos.map((p) => (
            <Pressable key={p.id} onPress={() => { setViewing(p); setCaption(p.caption ?? ''); }} accessibilityRole="button" accessibilityLabel={p.caption ? `Picture: ${p.caption}` : 'Open picture'}>
              <OptimizedImage source={p.fileUrl} style={[styles.thumb, { backgroundColor: colors.backgroundTertiary }]} />
            </Pressable>
          ))}
          <Pressable onPress={addPicture} disabled={uploading} accessibilityRole="button" accessibilityLabel="Add a picture" style={[styles.thumb, styles.addTile, { borderColor: colors.primary, opacity: uploading ? 0.6 : 1 }]}>
            <Icon name="camera" size={22} color={colors.primary} />
            <Text style={[typeScale.caption, { color: colors.primary, fontWeight: '700', marginTop: 4 }]}>{uploading ? 'Uploading…' : 'Add picture'}</Text>
          </Pressable>
        </View>
      </Card>

      {/* A picture, full size, with its caption */}
      <Modal visible={!!viewing} animationType="fade" onRequestClose={() => setViewing(null)} statusBarTranslucent>
        <View style={[styles.viewer, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.viewerTop}>
            <Pressable onPress={() => { if (viewing) updateOwnerPhotoCaption(viewing.id, caption); setViewing(null); }} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"><Text style={[typeScale.bodyLarge, { color: '#FFFFFF' }]}>Done</Text></Pressable>
            <Pressable onPress={() => viewing && confirm('Delete this picture?', 'It will be removed for good.', 'Delete', () => { removeOwnerPhoto(viewing); setViewing(null); })} hitSlop={12} accessibilityRole="button" accessibilityLabel="Delete this picture"><Icon name="trash-2" size={20} color="#FFFFFF" /></Pressable>
          </View>
          {viewing ? <OptimizedImage source={viewing.fileUrl} style={styles.viewerImage} /> : null}
          <TextInput value={caption} onChangeText={setCaption} placeholder="Add a caption (optional)" placeholderTextColor="rgba(255,255,255,0.5)" style={[typeScale.bodyLarge, styles.captionInput]} />
          {viewing ? <Text style={[typeScale.caption, { color: 'rgba(255,255,255,0.6)', textAlign: 'center' }]}>Added {when(viewing.createdAt)}</Text> : null}
        </View>
      </Modal>

      {/* The sorted list: read it, print it, or share it as a PDF */}
      <Modal visible={!!shown} animationType="slide" onRequestClose={() => setShown(null)}>
        <View style={[styles.listScreen, { backgroundColor: colors.background, paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.viewerTop}>
            <Pressable onPress={() => setShown(null)} hitSlop={12} accessibilityRole="button"><Text style={[typeScale.bodyLarge, { color: colors.primary }]}>Close</Text></Pressable>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]} numberOfLines={1}>{shown?.title}</Text>
            <View style={{ width: 44 }} />
          </View>
          <ScrollView bounces={false} contentContainerStyle={{ paddingVertical: spacing.md, gap: spacing.md }}>
            {shown && groupByCategory(shown.items).map((g) => (
              <View key={g.category}>
                <Text style={[typeScale.overline, { color: colors.primaryDark, marginBottom: spacing.xs }]}>{g.category.toUpperCase()}</Text>
                <View style={[styles.itemsBox, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                  {g.items.map((it, i) => (
                    <View key={`${it.item}-${i}`} style={[styles.itemRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{it.item}</Text>
                        {it.notes ? <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{it.notes}</Text> : null}
                      </View>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{quantityText(it)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {shown && shown.otherNotes.length > 0 ? (
              <View>
                <Text style={[typeScale.overline, { color: colors.primaryDark, marginBottom: spacing.xs }]}>OTHER NOTES</Text>
                {shown.otherNotes.map((n, i) => <Text key={i} style={[typeScale.bodyLarge, { color: colors.textPrimary, marginBottom: 4 }]}>• {n}</Text>)}
              </View>
            ) : null}
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Sorted from your notes on this phone. Check it over before you print: it only uses what you wrote, and anything it could not place is under Other notes.</Text>
          </ScrollView>
          <Button title="Print / Share as PDF" icon="share" onPress={() => shown && print(shown)} fullWidth size="lg" />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  privateTag: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  input: { minHeight: 80, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, textAlignVertical: 'top', marginBottom: spacing.sm },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden' },
  addTile: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: '#111111', paddingHorizontal: spacing.lg, gap: spacing.md },
  viewerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  viewerImage: { flex: 1, width: '100%', borderRadius: radius.md },
  captionInput: { color: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.3)', paddingVertical: spacing.sm },
  listScreen: { flex: 1, paddingHorizontal: spacing.lg },
  itemsBox: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md },
});
