'use server';

import { fetchFxRates, type FxRates } from '@/lib/fx';

export async function getFxRates(): Promise<FxRates | null> {
  return fetchFxRates();
}
