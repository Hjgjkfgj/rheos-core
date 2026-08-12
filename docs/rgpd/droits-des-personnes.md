# Procédure — Droits des personnes (RGPD)

> Procédure **opérationnelle** reliant les droits RGPD aux fonctions Rhéos réelles.
> Qualifications juridiques (délais légaux, motifs de refus) **⚖️ à valider par le juriste**.

## 1. Droit d'accès (art. 15) — export complet
**Qui** : service RH habilité (permission `person.read`), sur demande de la personne
transmise au responsable de traitement (l'employeur).

**Comment** :
- API : `GET /api/v1/persons/{personId}/access-request` → **JSON** (portable) ;
  `?format=pdf` → **PDF** imprimable.
- Contenu : identité, relations de travail (contrats, affectations, congés, temps),
  adresses, coordonnées bancaires **masquées**, identifiants sensibles **masqués**,
  documents (métadonnées + empreinte), demandes de changement, **journal d'accès**.
- **Journalisé** : chaque export écrit une entrée d'audit `person.access_request`
  (qui, quand, sur qui) + événement `PersonDataAccessRequested`.

**Valeurs sensibles (NIR/IBAN)** : **jamais réexposées en clair** dans l'export.
Elles sont communiquées **séparément**, sur demande vérifiée, via un accès habilité et audité.
⚖️ définir le canal de communication sécurisé et la procédure de vérification d'identité.

**Délai** : ⚖️ 1 mois (art. 12) — à intégrer au SLA client.

## 2. Rectification (art. 16)
Le collaborateur soumet une **demande de changement** (self-service, `ChangeRequest`) ;
le RH la **valide ou refuse** (traçé). Le collaborateur ne modifie jamais directement ses
données de référence.

## 3. Portabilité (art. 20)
Export **CSV/JSON** des collaborateurs (Lot 16) : `GET /api/v1/collaborators/export?format=csv|json`.
Pour une personne unique, l'export « droit d'accès » JSON fait foi.

## 4. Effacement / anonymisation (art. 17) — fin de rétention
**Principe** : en fin de durée de conservation (ou sur demande fondée), les données sont
**anonymisées** (l'enregistrement reste pour l'intégrité référentielle, mais les données
personnelles sont retirées) plutôt que supprimées brutalement.

**Pré-conditions** :
- **Aucune relation de travail active** (l'opération est refusée sinon).
- **Aucun legal hold** sur les documents (un document sous legal hold est **conservé** ;
  l'anonymisation le signale et s'arrête pour ce document).

**Comment** :
- API : `POST /api/v1/persons/{personId}/anonymize` (permission `person.write` + `document.delete`).
- **Commande** (batch de fin de rétention) :
  ```bash
  STORE=prisma DATABASE_URL="postgresql://rheos_app:***@HOST:PORT/rheos?sslmode=require" \
    npm run anonymize -- <TENANT_ID> <PERSON_ID>
  ```
- Effet : identité → `ANONYMISÉ` (nom, prénom, date de naissance, email retirés) ;
  **IBAN/NIR chiffrés purgés** ; documents **anonymisés** (rattachement personnel retiré,
  mécanique DELETE/ANONYMIZE/ARCHIVE existante) ; entrée d'audit `person.anonymize` +
  événement `PersonAnonymized`.

**Limite connue** : les **sauvegardes** chiffrées antérieures contiennent encore les
données (dump figé) — ⚖️ documenter le délai de purge des sauvegardes (le droit à l'effacement
se propage à l'expiration des sauvegardes).

## 5. Limitation / opposition (art. 18/21)
⚖️ Procédure à définir (marquage d'un traitement suspendu). Techniquement, la
désactivation d'accès est portée par l'événement de départ (`accessRevoked`).

## 6. Réclamation
La personne peut saisir la **CNIL**. Le DPO en est informé.
