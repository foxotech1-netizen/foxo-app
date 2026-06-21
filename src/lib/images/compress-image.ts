// Compression / redimensionnement des photos AVANT upload, côté navigateur.
//
// Pourquoi : les routes /api/ sont plafonnées à ~4,5 Mo par Vercel. Une photo
// de smartphone (souvent 3-8 Mo) est rejetée (« Request Entity Too Large »)
// AVANT d'atteindre la route, et le client plante en lisant un corps non-JSON.
// On ramène chaque photo à <= ~2000 px (grand côté), ré-encodée en JPEG q0.82
// (~1 Mo), avec l'orientation EXIF appliquée.
//
// Robustesse : tout échec de décodage (ex. HEIC hors Safari) ou de canvas
// renvoie le fichier d'origine inchangé (jamais pire qu'avant) ; le contrôle
// de statut HTTP côté appelant prend alors le relais.

const MAX_EDGE = 2000;
const QUALITY = 0.82;

export async function compressImage(file: File): Promise<File> {
  if (typeof document === 'undefined' || !file.type.startsWith('image/')) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', QUALITY);
    });
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}
