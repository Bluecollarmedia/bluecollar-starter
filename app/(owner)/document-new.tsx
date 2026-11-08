/**
 * Starts a new quote, change order or invoice, asking only what's missing:
 * which kind (from the company-wide overview), which project, and for an
 * invoice which approved quote and approved change orders to bill. Then it
 * creates the draft and opens the editor.
 *
 * A quote can be for an existing project or a new one. A new one is saved as
 * a Prospect (see NewProjectForm) and becomes Active when the quote is
 * approved and the owner starts the project.
 */

import { useBackStep } from '@/hooks/useBackStep';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, ListSection, ListRow, SearchBar, InlineNotice, StatusBadge } from '@/components/ui';
import { NewProjectForm } from '@/components/financials/NewProjectForm';
import { useTheme } from '@/providers/ThemeProvider';
import { db, useDb } from '@/data/store';
import { createQuote, createChangeOrder, createInvoice, uninvoicedChangeOrders, DOC_LABEL } from '@/data/financials';
import { formatMoney, sumMoney } from '@/lib/money';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { FinancialDocType } from '@/types/financial';
import type { ProjectStatus } from '@/types/project';

const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' }> = {
  prospect: { label: 'Prospect', tone: 'neutral' },
  active: { label: 'Active', tone: 'success' },
  on_hold: { label: 'On Hold', tone: 'warning' },
  completed: { label: 'Completed', tone: 'info' },
  archived: { label: 'Archived', tone: 'neutral' },
};

export default function NewDocumentScreen() {
  const params = useLocalSearchParams<{ kind?: FinancialDocType; projectId?: string; quoteId?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const v = useDb();
  const [kind, setKind] = useState<FinancialDocType | undefined>(params.kind);
  const [projectId, setProjectId] = useState<string | undefined>(params.projectId);
  const [quoteId, setQuoteId] = useState<string | undefined>(params.quoteId);
  const [coIds, setCoIds] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  // Quotes only: start from an existing project or a new one.
  const [quoteFor, setQuoteFor] = useState<'existing' | 'new' | undefined>();
  // The back swipe goes back a step inside this screen before it closes it.
  useBackStep(quoteFor !== undefined, () => setQuoteFor(undefined));
  const [newProject, setNewProject] = useState(false);
  const created = useRef(false);

  const project = useMemo(() => db.projects.find((p) => p.id === projectId), [projectId, v]);
  const approvedQuotes = useMemo(
    () => db.quotes.filter((q) => q.projectId === projectId && q.status === 'approved'),
    [projectId, v],
  );
  const changeOrders = useMemo(() => (projectId ? uninvoicedChangeOrders(projectId) : []), [projectId, v]);
  const projects = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = db.projects.filter((p) => p.status !== 'archived');
    // Change orders and invoices need an approved quote on the project.
    if (kind && kind !== 'quote') list = list.filter((p) => db.quotes.some((x) => x.projectId === p.id && x.status === 'approved'));
    if (q) {
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q) ||
        `${p.customer?.firstName ?? ''} ${p.customer?.lastName ?? ''}`.toLowerCase().includes(q));
    }
    return list;
  }, [search, kind, v]);

  // Pick the only approved quote automatically; tick every approved change order.
  useEffect(() => {
    if (!quoteId && approvedQuotes.length === 1) setQuoteId(approvedQuotes[0].id);
  }, [approvedQuotes, quoteId]);
  useEffect(() => {
    if (kind === 'invoice' && coIds === null && projectId) {
      setCoIds(changeOrders.filter((c) => !quoteId || !c.quoteId || c.quoteId === quoteId).map((c) => c.id));
    }
  }, [kind, coIds, projectId, changeOrders, quoteId]);

  const openEditor = (k: FinancialDocType, id: string) => {
    router.replace({ pathname: '/(owner)/document-edit', params: { kind: k, id, fresh: '1', ...(newProject ? { newProject: '1' } : {}) } } as any);
  };

  // Quotes, and change orders with a single approved quote, need no more questions.
  useEffect(() => {
    if (created.current || !kind || !projectId) return;
    if (kind === 'quote') {
      created.current = true;
      openEditor('quote', createQuote(projectId).id);
    } else if (kind === 'change_order' && quoteId) {
      created.current = true;
      openEditor('change_order', createChangeOrder(projectId, quoteId).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, projectId, quoteId]);

  const createInvoiceNow = () => {
    if (!projectId || created.current) return;
    created.current = true;
    openEditor('invoice', createInvoice(projectId, { quoteId, changeOrderIds: coIds ?? [] }).id);
  };

  const alreadyInvoiced = quoteId
    ? db.invoices.filter((i) => i.quoteId === quoteId && i.status !== 'void').map((i) => i.number)
    : [];

  let body: React.ReactNode;
  let title = kind ? `New ${DOC_LABEL[kind]}` : 'Create';

  if (!kind) {
    title = 'Create';
    body = (
      <ListSection title="WHAT WOULD YOU LIKE TO CREATE?">
        <ListRow icon="file-text" title="Quote" subtitle="Price new work for a project" showChevron onPress={() => setKind('quote')} />
        <ListRow icon="layers" title="Change Order" subtitle="Add or change work on an approved quote" showChevron onPress={() => setKind('change_order')} />
        <ListRow icon="dollar-sign" title="Invoice" subtitle="Bill an approved quote and approved changes" showChevron onPress={() => setKind('invoice')} />
      </ListSection>
    );
  } else if (kind === 'quote' && !projectId && !quoteFor) {
    title = 'Create a Quote';
    body = (
      <>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginBottom: spacing.md, marginLeft: spacing.xs }]}>
          Who is this quote for?
        </Text>
        <ChoiceCard
          icon="folder"
          title="Existing Project"
          text="Pick a project. Its customer and address fill in automatically."
          onPress={() => setQuoteFor('existing')}
        />
        <ChoiceCard
          icon="plus-circle"
          title="New Project"
          text="A new customer or property. It becomes a project once the quote is approved."
          onPress={() => setQuoteFor('new')}
        />
      </>
    );
  } else if (kind === 'quote' && !projectId && quoteFor === 'new') {
    title = 'New Project Quote';
    body = <NewProjectForm onReady={(id, created) => { setNewProject(created); setProjectId(id); }} />;
  } else if (!projectId) {
    body = (
      <>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search projects or customers" style={{ marginBottom: spacing.md }} />
        {projects.length === 0 ? (
          <InlineNotice
            icon="info"
            tone="neutral"
            text={kind === 'quote' ? 'No projects found. Go back and choose New Project instead.' : 'No projects with an approved quote yet.'}
          />
        ) : (
          <ListSection title="CHOOSE A PROJECT">
            {projects.map((p) => (
              <ListRow
                key={p.id}
                icon="briefcase"
                title={p.name}
                subtitle={[p.customer ? `${p.customer.firstName} ${p.customer.lastName}`.trim() : '', p.address].filter(Boolean).join(' · ')}
                rightElement={<StatusBadge label={PROJECT_STATUS[p.status]?.label ?? p.status} status={PROJECT_STATUS[p.status]?.tone ?? 'neutral'} />}
                onPress={() => setProjectId(p.id)}
              />
            ))}
          </ListSection>
        )}
      </>
    );
  } else if (approvedQuotes.length === 0 && kind !== 'quote') {
    body = (
      <InlineNotice icon="info" tone="neutral" text={`${project?.name ?? 'This project'} has no approved quote yet. Approve a quote first.`} />
    );
  } else if (kind === 'change_order' || (kind === 'invoice' && !quoteId)) {
    body = (
      <ListSection title="WHICH APPROVED QUOTE?">
        {approvedQuotes.map((q) => (
          <ListRow key={q.id} icon="file-text" title={q.number} subtitle={q.title ?? project?.name} value={formatMoney(q.total)} showChevron onPress={() => setQuoteId(q.id)} />
        ))}
      </ListSection>
    );
  } else if (kind === 'invoice') {
    const quote = approvedQuotes.find((q) => q.id === quoteId);
    const selected = coIds ?? [];
    const total = sumMoney([quote?.total ?? 0, ...changeOrders.filter((c) => selected.includes(c.id)).map((c) => c.total)]);
    body = (
      <>
        <ListSection title="INCLUDE FROM" footer="Line items are copied onto the invoice. You can adjust them next; the quote and change orders stay as they are.">
          {quote && (
            <ListRow icon="check-circle" iconColor={colors.primary} title={`Approved quote ${quote.number}`} value={formatMoney(quote.total)} />
          )}
          {changeOrders.map((c) => {
            const on = selected.includes(c.id);
            return (
              <Pressable
                key={c.id}
                onPress={() => setCoIds(on ? selected.filter((x) => x !== c.id) : [...selected, c.id])}
                style={styles.check}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <View style={[styles.box, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }]}>
                  {on && <Icon name="check" size={13} color="#FFFFFF" />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>Change order {c.number}</Text>
                  {!!c.description && <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>{c.description}</Text>}
                </View>
                <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, fontVariant: ['tabular-nums'] }]}>{formatMoney(c.total)}</Text>
              </Pressable>
            );
          })}
        </ListSection>
        {changeOrders.length === 0 && (
          <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: -spacing.sm, marginBottom: spacing.md, marginLeft: spacing.md }]}>
            No approved change orders waiting to be invoiced.
          </Text>
        )}
        {alreadyInvoiced.length > 0 && (
          <InlineNotice icon="alert-triangle" tone="warning" text={`${quote?.number} is already on ${alreadyInvoiced.join(', ')}. Make sure you're not billing the same work twice.`} style={{ marginBottom: spacing.md }} />
        )}
        <View style={styles.sumRow}>
          <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>Invoice total (before edits)</Text>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}>{formatMoney(total)}</Text>
        </View>
        <Button title="Create Invoice" onPress={createInvoiceNow} fullWidth />
      </>
    );
  } else {
    body = null; // creating…
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground, paddingTop: insets.top }]}>
      <View style={styles.header}>
        {quoteFor && !projectId && !params.projectId ? (
          <Pressable onPress={() => setQuoteFor(undefined)} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="chevron-left" size={24} color={colors.primary} />
          </Pressable>
        ) : (
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={[typeScale.bodyLarge, { color: colors.primary }]}>Cancel</Text>
          </Pressable>
        )}
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]}>{title}</Text>
        <View style={styles.headerBtn} />
      </View>
      {!!project && (
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm }]}>{project.name}</Text>
      )}
      <ScrollView bounces={false} contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing['2xl'] }]} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </View>
  );
}

function ChoiceCard({ icon, title, text, onPress }: { icon: 'folder' | 'plus-circle'; title: string; text: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.choice, { backgroundColor: pressed ? colors.backgroundSecondary : colors.surface, borderColor: colors.separator }]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.choiceIcon, { backgroundColor: colors.primarySurface }]}>
        <Icon name={icon} size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>{text}</Text>
      </View>
      <Icon name="chevron-right" size={20} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.md },
  choiceIcon: { width: 44, height: 44, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, height: 52 },
  headerBtn: { minWidth: 70, height: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  body: { padding: spacing.lg },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  box: { width: 22, height: 22, borderRadius: radius.xs + 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xs, marginBottom: spacing.md },
});
