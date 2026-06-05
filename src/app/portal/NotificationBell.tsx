'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { markMyNotificationsRead } from '@/app/portal/actions';

export type PortalNotification = {
  id: string;
  titre: string;
  message: string;
  lien: string | null;
  created_at: string;
};

// Date relative simple (fr-BE), aligné sur le rendu de MessagesPanel.
function relTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "à l'instant";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `il y a ${diffD} j`;
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function NotificationBell({
  notifications = [],
  unreadCount = 0,
}: {
  notifications?: PortalNotification[];
  unreadCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function toggle() {
    const next = !open;
    setOpen(next);
    // À l'ouverture seulement, et seulement s'il reste des non-lues :
    // marque tout lu côté serveur puis rafraîchit pour vider le badge.
    if (next && unreadCount > 0) {
      await markMyNotificationsRead();
      router.refresh();
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 8,
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.85)',
          cursor: 'pointer',
        }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 999,
              background: '#E5484D',
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Overlay : ferme le panneau au clic extérieur. */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 200 }}
          />
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 42,
              left: 0,
              width: 'min(300px, calc(100vw - 24px))',
              maxHeight: 380,
              overflowY: 'auto',
              background: '#fff',
              border: '1px solid var(--color-sand-border, #E7E0D4)',
              borderRadius: 12,
              boxShadow: '0 12px 32px rgba(0,0,0,.18)',
              zIndex: 201,
              color: '#1a1a1a',
            }}
          >
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid #EFEAE0',
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              Notifications
            </div>
            {notifications.length === 0 ? (
              <div style={{ padding: '18px 14px', fontSize: 12, color: '#8A8278', textAlign: 'center' }}>
                Aucune notification
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(n.lien || '/portal/interventions');
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 14px',
                    borderBottom: '1px solid #F2EEE5',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 2 }}>{n.titre}</div>
                  <div style={{ fontSize: 11, color: '#5A5346', lineHeight: 1.35 }}>{n.message}</div>
                  <div style={{ fontSize: 10, color: '#A39B8C', marginTop: 3 }}>{relTime(n.created_at)}</div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
