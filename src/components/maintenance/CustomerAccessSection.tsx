/**
 * Owner: how the customer of one maintenance property gets in. The customer gets ONE private one-time link
 * (supabase/updates/078_invite_links.sql) that covers everything on their customer record, and once signed up sees this property's
 * finished visits and the photos you share. To change or clear the customer of a property, edit the property (its Customer row);
 * to stop a customer using the app at all, turn off their Portal access on their customer page.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { ListSection } from '@/components/ui';
import { CustomerInviteCard } from '@/components/invites/CustomerInviteCard';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

export function CustomerAccessSection({ customer }: {
  /** The customer linked to this property, if any. */
  customer?: { id: string; firstName: string; phone?: string };
}) {
  const { colors } = useTheme();

  return (
    <ListSection title="CUSTOMER LOGIN">
      <View style={{ padding: spacing.md }}>
        {customer ? (
          <CustomerInviteCard personId={customer.id} firstName={customer.firstName} phone={customer.phone} />
        ) : (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>Link a customer to this property to send them a login link.</Text>
        )}
      </View>
    </ListSection>
  );
}
