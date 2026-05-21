SETUP

1. Upload index-rainbet-auto-stats.html as your homepage.
2. Add netlify/functions/rainbet-stats.js to your site repo.
3. In Netlify go to: Site settings > Environment variables.
4. Add:
   RAINBET_STATISTIC_TOKEN = your Rainbet API token
5. Redeploy.

Never put the token inside index.html.
