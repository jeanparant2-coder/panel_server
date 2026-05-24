# NodePilot - dossier autonome

Ce dossier contient tout ce qu'il faut pour publier et lancer le panel comme image Docker.

Image Docker cible :

```text
ghcr.io/jeanparant2-coder/panel_server:latest
```

## Publier l'image

Mets le contenu de ce dossier a la racine du repo GitHub :

```text
jeanparant2-coder/panel_server
```

Au prochain push sur `main`, GitHub Actions publiera l'image dans GitHub Container Registry.

## Lancer sur ton serveur

```bash
docker pull ghcr.io/jeanparant2-coder/panel_server:latest
docker compose up -d
```

Puis ouvre :

```text
http://IP_DU_SERVEUR:8080
```

Connexion :

```text
admin / admin
```

## Fichiers inclus

- `Dockerfile`
- `docker-compose.yml`
- `.github/workflows/docker-publish.yml`
- `package.json`
- `app/`
- `data/config.json` remis a zero

Le dossier `data/` garde les reglages, plugins et fichiers importes.
