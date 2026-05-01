export const dynamic = 'force-dynamic';

export default function NotesCreditPage() {
  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Notes de crédit</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Avoirs émis aux clients (à venir).
          </p>
        </div>
        <button
          type="button"
          disabled
          className="bg-navy text-white px-3.5 py-2 rounded-lg text-xs font-bold opacity-50 cursor-not-allowed"
          title="Module à venir"
        >
          + Nouvelle note de crédit
        </button>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="bg-cream rounded-xl border border-sand-border p-12 text-center dark:bg-[#1C1A16] dark:border-[#3D3A32]">
          <div className="text-4xl mb-3">📝</div>
          <h2 className="text-base font-extrabold text-ink mb-1 dark:text-[#F0ECE4]">
            Aucune note de crédit pour l&apos;instant
          </h2>
          <p className="text-[12px] text-ink-muted max-w-md mx-auto dark:text-[#C8C2B8]">
            Le module de notes de crédit (avoirs) sera disponible prochainement.
            Il permettra d&apos;émettre des avoirs liés à une facture, avec
            génération du PDF et envoi automatique au client.
          </p>
        </div>
      </div>
    </>
  );
}
