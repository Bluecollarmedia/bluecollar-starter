import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { LegalScreen } from '@/components/legal/LegalScreen';
import { isLegalSlug } from '@/lib/legalPaths';

/** The body of every "<area>/legal-support/[slug]" route: shows that document, or goes home if the address is not one of the three. */
export function LegalDocRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  if (!isLegalSlug(slug)) return <Redirect href="/" />;
  return <LegalScreen slug={slug} />;
}
