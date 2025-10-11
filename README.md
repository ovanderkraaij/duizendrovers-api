# Duizendrovers API (Node + TS + MySQL)

## Endpoints
- `GET /api/health`
- `GET /api/v1/classifications`
- `GET /api/v1/classifications/current?season_id=&league_id=`
- `GET /api/v1/classifications/user/:user_id?season_id=&league_id=`
- `GET /api/v1/classifications/trend?season_id=&league_id=&window=10`

## Local
```bash
cp .env.example .env
npm ci
npm run dev
```
