# Local PostgreSQL setup

1. Install PostgreSQL for Windows and remember the password chosen for the `postgres` user.
2. Open PowerShell in this project folder and create the database:

```powershell
createdb -U postgres chess_tournament
```

3. Copy `.env.example` to `.env` and replace `YOUR_PASSWORD` in `DATABASE_URL`.
4. Install dependencies and start the app:

```powershell
npm install
npm start
```

The server creates the PostgreSQL tables automatically. The same `DATABASE_URL` variable can be configured in a cloud provider later; no application code change is needed.