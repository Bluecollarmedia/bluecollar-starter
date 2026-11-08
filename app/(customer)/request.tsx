// The same form as the public Weather area's Request tab, opened from the "Request a service" card on the signed-in customer's Home.
// The customer is signed in, so the "No account needed" line is left out and their own name, phone and email are filled in.
import React from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { RequestForm } from '../weather/(tabs)/request';

export default function CustomerRequest() {
  const { user } = useAuth();
  const name = [user?.firstName, user?.lastName].filter((x) => !!x && x.trim()).join(' ');
  return (
    <RequestForm
      signedIn
      scrollPath="/request"
      prefill={{ name, phone: user?.phone ?? '', email: user?.email ?? '' }}
    />
  );
}
