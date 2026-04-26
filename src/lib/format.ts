export function fmtDateTime(iso: string | null, full = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return full
    ? d.toLocaleString('fr-BE', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
      })
    : d.toLocaleDateString('fr-BE', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', {
    weekday: 'short', day: 'numeric', month: 'long',
  });
}

export function relTime(iso: string | null): string {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return '< 1h';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}j`;
}

export function todayLong(): string {
  return new Date().toLocaleDateString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
