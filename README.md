# NodePilot

Panel Docker local avec connexion, dashboard personnalisable, gestion des conteneurs, images, logs, extensions et plugins.

Image Docker publiee :

```text
ghcr.io/jeanparant2-coder/panel_server:latest
```

## Publier l'image

Pousse ce depot sur GitHub dans :

```text
jeanparant2-coder/panel_server
```

La GitHub Action `.github/workflows/docker-publish.yml` build et publie automatiquement l'image sur GHCR a chaque push sur `main`.

## Lancer sur un serveur

```bash
docker pull ghcr.io/jeanparant2-coder/panel_server:latest
docker compose up -d
```

Ou sans compose :

```bash
docker run -d --name nodepilot -p 8080:8080 -v nodepilot-data:/data -v /var/run/docker.sock:/var/run/docker.sock --restart unless-stopped ghcr.io/jeanparant2-coder/panel_server:latest
```

Puis ouvrir :

```text
http://IP_DU_SERVEUR:8080
```

Connexion par defaut :

```text
admin / admin
```

## Notes

- Le montage `/var/run/docker.sock` donne au panel le droit de piloter Docker.
- Les plugins `.jar` importes sont stockes dans `/data/plugins`; ils ne sont pas executes automatiquement.
- Les donnees persistantes sont dans `/data`.
