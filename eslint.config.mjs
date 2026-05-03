import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Désactive react-hooks/refs uniquement sur InterventionsClient.tsx :
  // le plugin émet ~120 faux positifs sur les accès `selected.acp?.…`
  // (il interprète à tort la propriété `.acp` comme un useRef alors que
  // c'est juste une propriété d'objet). Le code est correct, on isole
  // la suppression à ce seul fichier le temps d'un upgrade du plugin.
  {
    files: ["src/app/admin/InterventionsClient.tsx"],
    rules: {
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
