# Rhéos — PWA : installabilité & Lighthouse

## Icônes (Lot 13)
- `web/icon.svg` (source), `web/icon-192.png` (192×192), `web/icon-512.png` (512×512),
  générées depuis le SVG (`qlmanage` + `sips`), servies par l'API (`/icon-192.png`,
  `/icon-512.png`, `content-type image/png`) et précachées par le service worker.

## Exigences d'installabilité — vérifiées (test `test/front.test.ts`)
| Exigence Lighthouse « Installable » | État |
|---|---|
| Manifest servi (`/manifest.webmanifest`) | ✅ |
| `name` + `short_name` | ✅ |
| `start_url` (`/espace`) | ✅ |
| `display: standalone` | ✅ |
| Icône **192×192 PNG** | ✅ |
| Icône **512×512 PNG** | ✅ |
| Icône **maskable** | ✅ |
| `theme_color` | ✅ |
| Service worker enregistré **avec handler `fetch`** | ✅ |
| Servi sur origine sécurisée (localhost/HTTPS) | ✅ (localhost) |

Toutes les conditions d'installabilité sont réunies et couvertes par un test automatisé.

## Exécuter Lighthouse (procédure — aucun CLI headless dans l'environnement de build)
Chrome CLI/`lighthouse` ne sont pas installés ici (Chrome.app présent, pas de binaire
headless exposé). Pour produire le rapport sur ta machine :

```bash
# 1. Démarrer l'app
STORE=memory npm start        # http://localhost:3000/espace

# 2. Lancer Lighthouse (nécessite Node + Chrome installés)
npx lighthouse http://localhost:3000/espace \
  --only-categories=pwa,accessibility \
  --preset=desktop \
  --output=html --output-path=./lighthouse-espace.html \
  --chrome-flags="--headless=new"
```

Cibles : **PWA installable** (toutes les conditions ci-dessus sont vertes) et
**Accessibilité ≥ 90** (rôles `tab`/`tabpanel`, navigation clavier, `aria-label`,
contrastes, `lang="fr"`, focus visibles — voir `web/espace.html`). Joindre
`lighthouse-espace.html` au dossier une fois exécuté.
