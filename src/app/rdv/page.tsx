import { getMonthSlots, type Slot } from '@/lib/portal/availability';
import { RdvClient } from './RdvClient';

export const dynamic = 'force-dynamic';

export default async function RdvPage() {
  // Charge 2 mois de dispos pour permettre une nav simple côté client.
  const now = new Date();
  const m0 = { year: now.getFullYear(), month: now.getMonth() };
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const m1 = { year: next.getFullYear(), month: next.getMonth() };

  const [slotsThisMonth, slotsNextMonth] = await Promise.all([
    getMonthSlots(m0.year, m0.month),
    getMonthSlots(m1.year, m1.month),
  ]);

  const months: Array<{ year: number; month: number; slots: Slot[] }> = [
    { ...m0, slots: slotsThisMonth },
    { ...m1, slots: slotsNextMonth },
  ];

  return <RdvClient months={months} />;
}
