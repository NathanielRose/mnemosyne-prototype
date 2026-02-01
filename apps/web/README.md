# Mnemosyne Web (Vite + React + TypeScript)

Frontend-only UI packaged with Docker. The production container serves the static build via a tiny Express server that respects `PORT`.

## Docker

Build:

```
docker build -t mnemosyne-web .
```

Run:

```
docker run -p 3000:3000 -e PORT=3000 mnemosyne-web
```

## Railway

Deploy using Dockerfile.
