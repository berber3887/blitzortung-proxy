# Blitzortung Proxy — Sérezin-de-la-Tour

Serveur Node.js qui se connecte au WebSocket Blitzortung et expose une API REST
pour récupérer les vrais impacts de foudre dans les 40 km autour de Sérezin-de-la-Tour.

## Déploiement sur Render.com (gratuit)

1. Crée un compte sur https://render.com
2. New → Web Service → "Build and deploy from a Git repository"
3. Connecte GitHub et upload ce dossier
4. Render détecte automatiquement Node.js
5. Start command : `node server.js`
6. Plan : Free

## API

- GET /strikes → impacts récents (param: ?minutes=60)
- GET /health → statut de connexion
