import { redirect } from 'next/navigation';

// /auth tout court — pas de page racine pour le sous-domaine auth.
// Le proxy sur prod redirige déjà auth.foxo.be/ → /auth/login directement,
// mais cette page sert de filet en dev (localhost:3000/auth) et pour tout
// rendu de /auth qui n'aurait pas été intercepté par le proxy.
export default function AuthIndex() {
  redirect('/auth/login');
}
