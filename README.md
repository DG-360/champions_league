# Champions League Predictor 2026/27

A separate UEFA Champions League predictor based on the existing Premier League app.

## GitHub Pages URL

If this folder is pushed to a repository named `DG-360/champions_league` and GitHub Pages is enabled from the `main` branch root, the site URL will be:

`https://dg-360.github.io/champions_league/`

## Included features

- Separate Champions League player accounts and passwords
- Remember last-used player on each device
- Admin mode with the same existing admin key behavior
- Admin password reset and delete-user controls
- Admin manual result entry / correction
- Admin kick-off time overrides
- Club crest/logo upload, including multi-file crest upload
- Automatic Champions League fixture synchronization
- Automatic Champions League result synchronization
- League-phase standings table (official API ordering when available)
- Predictor scoreboard and round-by-round scoring
- 3 / 2 / 1 / 0 score-prediction rules
- Winner + runner-up season bonus
- Streak badges
- Fanzone / supporter battles
- Betable crowd + historical UCL Elo/form model view

## Data separation

This app uses the same Firebase database URL as the other predictor, but all Champions League data is stored under:

`cl2627`

The Premier League app uses its own root, so accounts, predictions, results, crests, Fanzone posts, and admin settings do not collide.

## First-time setup

1. Create a new GitHub repository named `champions_league` under `DG-360`.
2. In the new repository go to **Settings → Secrets and variables → Actions** and add a repository secret named **`TK2`** containing the same football-data.org API token used by the Premier League repository. GitHub does not automatically copy repository secrets to a new repository.
3. Upload/push the contents of this folder to the repository root.
4. Open **Actions → Sync Champions League fixtures and results → Run workflow** once. The workflow then runs hourly automatically.
5. Open **Actions → Update Champions League Betable model → Run workflow** once after the fixture sync. If it happens to run before fixtures exist, it exits cleanly and waits for the next run.
6. Go to **Settings → Pages** and choose **Deploy from a branch → main → /(root)**.

## Automatic API sync

`scripts/fetch-results.mjs` calls football-data.org competition code `CL` and publishes:

- participating teams
- match fixtures
- kick-off times
- stages / round labels
- finished scores
- official league-phase standings when the standings endpoint is available
- final winner metadata when available

Qualification/preliminary rounds are excluded so the predictor begins with the main Champions League competition.

The sync never overwrites a result that an admin entered manually. Automatically imported results may be refreshed if the API corrects them.



The Champions League version does not reuse the Premier-League-only training data. `scripts/bettable_model.py` trains an independent UCL Elo/form model from recent historical Champions League result files, advances the team state with the current season, and publishes probabilities to `cl2627/modelPredictions`.

## Data attribution

The public site includes the required visible attribution: **Data provided by football-data.org**.
