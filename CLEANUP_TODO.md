# Cleanup résiduel — état au 2026-05-01

Suite à la session de cleanup Fallow (16 commits sur `cleanup/fallow-remediation`,
voir `git log master..cleanup/fallow-remediation`). Ce fichier liste **ce qui
reste explicitement hors scope** de cette session, avec assez de contexte pour
qu'une nouvelle session puisse reprendre.

---

## État de référence (à valider en début de prochaine session)

```bash
cd /home/octopusman/Documents/ClawdDesktopLinux/.worktrees/cleanup-fallow-remediation
npx fallow dead-code --format json --quiet 2>/dev/null | jq '.total_issues'
# Attendu : 99
npx fallow dupes --format json --quiet 2>/dev/null | jq '.clone_groups | length'
# Attendu : 90
npm test
# Attendu : 2013 main + 1161 renderer, exit 0
npm run build
# Attendu : 0 errors
```

Si un chiffre a bougé : du code a été ajouté entre-temps, refaire un snapshot avant d'attaquer.

---

## 1. Hotspots CRAP catastrophiques (priorité haute, gros refacto)

Trois fonctions ont une complexité hors-norme (CRAP > 1000, le seuil "rouge" est 30).
Mesures via `npx fallow health --format json --quiet --explain` au début de la session :

| # | Fonction | Fichier:ligne | Cyclo | Cog | CRAP |
|---|----------|---------------|-------|-----|------|
| 1 | `consumeStream` | `src/main/services/sessionManager.ts:265` | 127 | **374** | 3610 |
| 2 | `streamMessageOneShot` | `src/core/services/streaming.ts:315` | 127 | 168 | 3610 |
| 3 | Stream listener anonyme | `src/renderer/stores/chatStore.ts:576` | 113 | 173 | 2871 |

### Stratégie suggérée par fonction

**`consumeStream` (cognitive 374 = le pire)** — c'est probablement le plus
structurellement décomposable. La fonction contient un `for await` sur
`session.query` qui dispatch sur `msg.type`. Découpage proposé :
- Extract `handleMessage(session, msg)` qui ne fait que le switch type→sub-handler
- Extract `handleEmptyExitLoop(session, consecutiveEmptyExits)` pour la boucle d'erreurs
- Extract `handleClosingState(session)` pour le cleanup
- Garder la coordination `consumeStream` mais limitée à la boucle externe + try/catch

**`streamMessageOneShot`** — orchestration du SDK Claude. Découpage :
- Extract `prepareSdkOptions(messages, systemPrompt, aiSettings, sdkSessionId)` qui
  construit le `queryOptions` (déjà aidé par `applyAiSettingsToQueryOptions` extrait
  en commit `45a8981`)
- Extract `accumulateMessages(query)` qui collecte le résultat brut
- `streamMessageOneShot` devient une orchestration (3 calls + try/finally)

**Stream listener `chatStore.ts:576`** — c'est un switch géant sur
`StreamChunk['type']`. Découpage :
- Le pattern `if (chunk.type === 'X') { ... }` répété ~15 fois → table de handlers
  `const chunkHandlers: Record<StreamChunk['type'], (chunk, store) => void>`
- Chaque handler est une fonction simple
- Le listener devient `chunkHandlers[chunk.type]?.(chunk, store)`

### Garde-fou

Les 3 fonctions sont **chemin chaud** : le streaming est appelé à chaque
message, par tous les utilisateurs. Tester en `npm run dev` après chaque
sous-extraction et envoyer un vrai message à l'agent (Claude SDK + PI SDK)
pour valider qu'aucun chunk type n'est perdu en route.

---

## 2. Cycles d'imports main/services (20 cycles)

Tous les cycles trouvés par Fallow concernent `src/main/index.ts` et
`src/main/services/*` qui s'importent mutuellement.

```bash
npx fallow dead-code --format json --quiet 2>/dev/null \
  | jq -r '.circular_dependencies[] | (.files | join(" -> "))'
```

Échantillons :
- `main/index.ts → ipc.ts → services/quickChat.ts → services/streaming.ts`
- `main/index.ts → services/scheduler.ts → services/schedulerBridge.ts`
- `services/sessionManager.ts → services/streaming.ts → services/schedulerBridge.ts`

### Stratégie suggérée

Créer `src/main/context.ts` qui détient les références partagées
(`BrowserWindow`, `db`, `broadcaster`, `engine`). Tous les services importent
de `context.ts` au lieu de s'importer mutuellement.

```ts
// src/main/context.ts
export interface MainContext {
  db: SqlJsAdapter
  broadcaster: Broadcaster
  engine: AgentEngine
  mainWindow: () => BrowserWindow | null
}

let _ctx: MainContext | null = null
export function setMainContext(ctx: MainContext): void { _ctx = ctx }
export function getMainContext(): MainContext {
  if (!_ctx) throw new Error('main context not initialized')
  return _ctx
}
```

`main/index.ts` appelle `setMainContext(...)` une fois après init. Chaque
service utilise `getMainContext()` à l'usage (pas au top-level — sinon le
cycle réapparaît à l'init).

### Risque

Refacto étendu (touche `index.ts` + ~10 fichiers `services/*`). Faire
**un service à la fois**, commit, test, suivant. L'ordre suggéré :
1. `services/streaming.ts` (le plus importé, casser ses imports outbound réduit
   plusieurs cycles d'un coup)
2. `services/sessionManager.ts`
3. `services/scheduler.ts` + `schedulerBridge.ts` ensemble (couplés)
4. Le reste suit naturellement

---

## 3. Hotspots medium-effort restants (priorité moyenne)

Du plan original (`/home/octopusman/.claude/plans/ok-on-va-continuer-noble-origami.md`),
les hotspots `effort: medium` qu'on n'a PAS encore touchés :

| Fichier | CRAP | Pattern probable |
|---------|------|------------------|
| `src/renderer/components/settings/TTSSettings.tsx:28` | 2862 | UI complexe avec options vocales (53 cyclo, 46 cog) |
| `src/renderer/components/settings/AppearanceSettings.tsx:31` | 1722 | Theme picker + options (41 cyclo) |
| `src/renderer/pages/ChatView.tsx:45` | 1722 | Composant React init (41 cyclo) |
| `src/renderer/components/mcp/McpServerForm.tsx:39` | 600 | Form validation MCP |
| `src/renderer/layouts/MainLayout.tsx:107` | 702 | Layout switch responsive |
| `src/core/handlers/messages.ts:637` | 482 | Probable big switch handler |
| `src/main/services/sessionManager.ts:672` | 708 | Autre fonction du même fichier que `consumeStream` |
| `resources/mcp/scheduler-server.mjs:172` | 240 | MCP scheduler outils |

### Stratégie commune

Ces fonctions sont volumineuses mais pas inextricables. Pattern probable
pour chacun : extract sub-components / sub-functions par responsabilité
isolée. Pas de surprise architecturale, juste de la patience.

À tester visuellement (`npm run dev`) après chaque refacto UI.

---

## 4. Findings Fallow restants à investiguer

```bash
npx fallow dead-code --format json --quiet 2>/dev/null \
  | jq '{exports: .unused_exports, types: .unused_types, members: .unused_class_members}'
```

- **51 unused_exports** : à tracer un par un avec `--trace`. Plusieurs sont
  probablement des re-exports orphelins (chemin shared/types vers core/types
  par ex.) ou des helpers exposés trop largement
- **15 unused_types** : idem, à investiguer cas par cas
- **13 unused_class_members** : restants après le commit piUIContext
  fallow-ignore. Listés dans :
  - `src/core/db/sqljs-adapter.ts` (`exec`, `transaction`)
  - `src/core/dispatch.ts` (`has`, `entries`)
  - `src/core/events.ts` (`emit`, `on`, `once`, `off`) — c'est l'EventEmitter
    typé, vraiment utilisé ?
  - `src/core/services/scheduler.ts` (`update`, `delete`, `toggle`,
    `conversationTasks`, `hasEnabledTasks`)

Pour chacune, appliquer la matrice étape 2 (consumers externes / internes /
zéro → KEEP/DROP_BARREL/SUPPRESS).

---

## 5. Faux positifs Fallow rencontrés (mémoire institutionnelle)

À documenter ailleurs (CLAUDE.md ?) si on continue à utiliser Fallow :

1. **Fallow ne propage pas `export *`** — flagué `unresolved-import` même
   quand TypeScript résout. Cas réel : `src/renderer/utils/groupStreamParts.ts`
   importe `StreamPart` depuis `shared/types` qui fait `export * from
   '../core/types/types'`. Suppress inline avec raison documentée.

2. **Fallow filtre les dossiers nommés `attachments/`** par une heuristique
   built-in non documentée. Voir le commit `70b723a` (rename
   `components/attachments` → `components/file-attach`). À éviter pour de
   nouveaux dossiers.

3. **`fallow-ignore-next-line duplicate-export` ne marche pas** malgré la
   suggestion du JSON `actions`. Renommer ou ignorer au niveau fichier.

4. **`scripts/**` exclu** du `.fallowrc.json` sinon `npm run audit:dedup`
   et autres se font flagger.

5. **`graphify-out/` regenere après chaque commit** (hook). Il est dans
   `.gitignore` désormais (commit `0694929`) — éviter `git add -A` aveugle
   si le hook a tourné.

---

## 6. Comment finaliser cette branche

```bash
# Option A : créer une PR (recommandé pour review)
cd /home/octopusman/Documents/ClawdDesktopLinux/.worktrees/cleanup-fallow-remediation
git push -u origin cleanup/fallow-remediation
gh pr create --title "Fallow cleanup: -40% dead-code, -77% dupes" --body "$(cat <<EOF
16 commits chirurgicaux. Build vert + tests verts (3174 passing) à chaque commit.

## Stats
- Fallow dead-code: 165 → 99 (-40%)
- Fallow dupes: 389 → 90 clone groups (-77%)
- Lignes dupliquées: 8948 → 2036
- dead_file_pct: 7.0% → 0.0%
- duplication_pct: 9.7% → 4.1%
- unused_deps: 4 → 0

## Hors scope (voir CLEANUP_TODO.md)
- 3 hotspots CRAP > 1000 (refacto profond)
- 20 cycles main/services (refacto structurel séparé)
- 7 hotspots medium-effort UI
EOF
)"

# Option B : merge direct dans master
cd /home/octopusman/Documents/ClawdDesktopLinux
git merge --no-ff cleanup/fallow-remediation
```

Le worktree peut ensuite être nettoyé :
```bash
git worktree remove .worktrees/cleanup-fallow-remediation
git branch -D cleanup/fallow-remediation  # uniquement après merge
```

---

## 7. Pour reprendre dans une nouvelle session

Phrase de relance suggérée :

> "Reprends le cleanup Fallow là où on s'était arrêté. La branche
> `cleanup/fallow-remediation` est dans le worktree
> `.worktrees/cleanup-fallow-remediation`. Lis
> `CLEANUP_TODO.md` à la racine du worktree pour le contexte. On
> attaque [hotspot CRAP / cycles main / hotspots medium / unused-exports
> résiduels — choisir]."

Le plan d'origine est aussi consultable :
`/home/octopusman/.claude/plans/ok-on-va-continuer-noble-origami.md`
