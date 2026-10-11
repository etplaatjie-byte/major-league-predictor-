# Major League Predictor (V1.0)

A small Vercel app for upcoming fixtures in the Premier League, La Liga, Bundesliga, Serie A, Ligue 1 and UEFA Champions League. It calls API-Football only from a serverless endpoint; the API key is never sent to the browser.

## Deploy from an iPad
1. Create/sign in to GitHub and create a new **private** repository, e.g. `major-league-predictor`.
2. Upload the contents of this folder to the repository root (not the containing folder).
3. In Vercel, choose **Add New → Project**, import that GitHub repository, and deploy.
4. In the Vercel project, open **Settings → Environment Variables**.
5. Add `API_FOOTBALL_KEY` with your API-Football key as the value. Select Production and Preview (Development optional). Do not paste the key into code or chat.
6. Redeploy from the Deployments tab after adding the variable.
7. Open the deployed URL and tap **Load fixtures & predictions**.

## Important limitations
- The endpoint requests fixtures in the next seven days and completed 2024-season results per competition. API-Football Free access to seasons/coverage can vary; errors are displayed rather than hidden.
- Each initial refresh can use up to 12 API requests (one upcoming-fixtures request and one historical request for each of six competitions). Do not repeatedly refresh; API-Football Free quota is 100 requests/day.
- Predictions use a simple historical-goal Poisson baseline and require at least three completed matches for each named team. Name mismatches can cause an unavailable prediction; we intentionally do not fabricate a probability.
- This is a testable first baseline, not a proven high-accuracy or profitable betting system. It must be backtested before trust.
